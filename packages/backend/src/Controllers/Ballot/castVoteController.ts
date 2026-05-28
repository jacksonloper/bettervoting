import { Election } from "@equal-vote/star-vote-shared/domain_model/Election";
import { Ballot, ballotValidation, NewBallot, OrderedNewBallot, RaceCandidateOrder } from '@equal-vote/star-vote-shared/domain_model/Ballot';
import ServiceLocator from "../../ServiceLocator";
import Logger from "../../Services/Logging/Logger";
import { BadRequest, Conflict, InternalServerError, Unauthorized } from "@curveball/http-errors";
import type { ILoggingContext } from "../../Services/Logging/ILogger";
import { randomUUID } from "crypto";
import { Receipt } from "../../Services/Email/EmailTemplates";
import {
    getOrCreateElectionRoll,
    checkForMissingAuthenticationData,
    getVoterAuthorization,
    inputsFromContext,
} from "../Roll/voterRollUtils";
import { innerGetGlobalElectionStats } from "../Election";
import { expectPermission } from "../controllerUtils";
import { permissions } from "@equal-vote/star-vote-shared/domain_model/permissions";
import { OrderedVote } from "@equal-vote/star-vote-shared/domain_model/Vote";
import { Score } from "@equal-vote/star-vote-shared/domain_model/Score";
import { makeUniqueID, ID_LENGTHS, ID_PREFIXES } from "@equal-vote/star-vote-shared/utils/makeID";
import { CastVoteEvent } from "../../Models/CastVoteStore";
import { C, body, election, logCtx, user } from "../../honoTypes";

const ElectionsModel = ServiceLocator.electionsDb();
const BallotModel = ServiceLocator.ballotsDb();
const EventQueue = ServiceLocator.eventQueue();
const EmailService = ServiceLocator.emailService();

type BallotSubmitType = 'submitted_via_browser' | 'submitted_via_admin' | 'submitted_via_discord';

const castVoteEventQueue = "castVoteEvent";

async function makeBallotEvent(
    c: C,
    targetElection: Election,
    inputBallot: NewBallot,
    submitType: BallotSubmitType,
    voter_id?: string,
    adminUsername?: string,
) {
    const ctx = logCtx(c);
    const inputs = inputsFromContext(c);
    inputBallot.election_id = targetElection.election_id;
    let roll = null;
    if (targetElection.state !== 'draft' && election(c).ballot_source !== 'prior_election') {
        const missingAuthData = checkForMissingAuthenticationData(inputs, targetElection, voter_id);
        if (missingAuthData !== null) {
            throw new Unauthorized(missingAuthData);
        }
        roll = await getOrCreateElectionRoll(inputs, targetElection, voter_id, true);
        const voterAuthorization = getVoterAuthorization(roll, missingAuthData);
        assertVoterMayVote(voterAuthorization, targetElection, ctx);

        if (roll) inputBallot.precinct = roll.precinct;
        const validationErr = ballotValidation(targetElection, inputBallot);
        if (validationErr) {
            const errMsg = `Invalid Ballot: ${validationErr}`;
            Logger.info(ctx, errMsg);
            throw new BadRequest(errMsg);
        }
    }

    inputBallot.date_submitted = Date.now();
    inputBallot.status = 'submitted';
    if (inputBallot.history == null) inputBallot.history = [];

    let updatableBallot;
    if (targetElection.settings.ballot_updates && targetElection.state !== 'draft') {
        try {
            updatableBallot = await BallotModel.getBallotByVoterID(roll!.voter_id, inputBallot.election_id, ctx);
        } catch (e: any) {
            const msg = "Error searching for prior ballot";
            Logger.error(ctx, msg, e);
            throw new InternalServerError(msg);
        }
    }
    if (updatableBallot) {
        inputBallot.ballot_id = updatableBallot.ballot_id;
    } else if (!inputBallot.ballot_id || targetElection.ballot_source !== 'prior_election') {
        inputBallot.ballot_id = await makeUniqueID(
            ID_PREFIXES.BALLOT,
            ID_LENGTHS.BALLOT,
            async (id: string) => await BallotModel.getBallotByID(id, ctx) !== null,
        );
    }
    inputBallot.history.push({
        action_type: submitType,
        actor: roll === null ? '' : roll.voter_id,
        timestamp: inputBallot.date_submitted,
    });

    if (roll != null) {
        roll.ballot_id = String(inputBallot.ballot_id);
        roll.submitted = true;
        if (roll.history == null) roll.history = [];
        roll.history.push({
            action_type: updatableBallot ? "update" : "submit",
            actor: (submitType === 'submitted_via_admin' && adminUsername) ? adminUsername : (roll === null ? '' : roll.voter_id),
            timestamp: inputBallot.date_submitted,
        });
    }

    if (election(c).ballot_source !== 'prior_election') Logger.debug(ctx, "Submit Ballot:", inputBallot);

    return {
        requestId: ctx.contextId ?? randomUUID(),
        inputBallot: inputBallot as Ballot,
        roll: roll || undefined,
        userEmail: undefined as string | undefined,
        isBallotUpdate: !!updatableBallot,
    };
}

const mapOrderedNewBallot = (ballot: OrderedNewBallot, raceOrder: RaceCandidateOrder[]): NewBallot => {
    const subBallot: any = { ...ballot };
    delete subBallot.orderedVotes;
    if (ballot.orderedVotes.length !== raceOrder.length) {
        throw new BadRequest(`Ballot contains different number of races than race_order: ${ballot.orderedVotes.length} != ${raceOrder.length}`);
    }
    return {
        ...subBallot,
        votes: ballot.orderedVotes.map((vote: OrderedVote, i) => {
            if (vote.length !== raceOrder[i].candidate_id_order.length + 2) {
                throw new BadRequest(`Race ${i} contains different number of candidates than race_order: ${vote.length} != ${raceOrder[i].candidate_id_order.length + 2}`);
            }
            return {
                race_id: raceOrder[i].race_id,
                scores: vote.slice(0, -2).map((s, j) => ({
                    candidate_id: raceOrder[i].candidate_id_order[j],
                    score: s,
                } as Score)),
                overvote_rank: vote.at(-2),
                has_duplicate_rank: vote.at(-1) === 1,
            };
        }),
    };
};

export const uploadBallotsController = async (c: C) => {
    const ctx = logCtx(c);
    const ua = c.var.user_auth!;
    Logger.info(ctx, "Upload Ballots Controller");
    expectPermission(ua.roles, permissions.canUploadBallots);

    const targetElection = election(c);
    if (targetElection == null) {
        const errMsg = "Invalid Ballot: invalid election Id";
        Logger.info(ctx, errMsg);
        throw new BadRequest(errMsg);
    }

    const reqBody = await body(c);
    const events = await Promise.all(
        reqBody.ballots.map(({ ballot, voter_id }: { ballot: OrderedNewBallot; voter_id: string }) =>
            makeBallotEvent(
                c,
                targetElection,
                structuredClone(mapOrderedNewBallot(ballot, reqBody.race_order as RaceCandidateOrder[])),
                'submitted_via_admin',
                voter_id,
                user(c)?.username,
            ).catch((err) => ({ error: err, ballot })),
        ),
    );

    const output = events.map((event: any, i: number) => ({
        voter_id: reqBody.ballots[i].voter_id,
        success: !('error' in event),
        message: ('error' in event) ? event.error : 'Success',
    }));

    try {
        if (targetElection.ballot_source === 'prior_election') {
            await BallotModel.bulkSubmitBallots(
                events.filter((event: any) => !('error' in event)).map((event: any) => event.inputBallot),
                ctx,
                `Admin submits a ballot for prior election`,
            );
        } else {
            const validEvents = events.filter((event: any) => !('error' in event)) as CastVoteEvent[];
            const successfullySavedEvents: CastVoteEvent[] = [];
            for (const event of validEvents) {
                const eventCtx = Logger.createContext(event.requestId);
                try {
                    await ServiceLocator.castVoteStore().submitBallotEvent(event, eventCtx);
                    successfullySavedEvents.push(event);
                } catch (e: any) {
                    Logger.error(ctx, `Could not upload ballot for ${event.roll?.voter_id || event.inputBallot.user_id || 'unknown'}: ${e.message}`);
                    const index = events.indexOf(event);
                    if (index !== -1) {
                        output[index].success = false;
                        output[index].message = e.message;
                    }
                }
            }
            if (successfullySavedEvents.length > 0) {
                await (await EventQueue).publishBatch(castVoteEventQueue, successfullySavedEvents);
            }
        }
    } catch (err: any) {
        const msg = `Could not upload ballots`;
        Logger.error(ctx, `${msg}: ${err.message}`);
        throw new InternalServerError(msg);
    }

    // socket.io isn't viable in Netlify functions — silently skip the live update.
    Logger.debug(ctx, "CastVoteController done, saved event to store");
    return c.json({ responses: output }, 200);
};

export const castVoteController = async (c: C) => {
    const ctx = logCtx(c);
    Logger.info(ctx, "Cast Vote Controller");
    const targetElection = election(c);
    if (targetElection == null) {
        const errMsg = "Invalid Ballot: invalid election Id";
        Logger.info(ctx, errMsg);
        throw new BadRequest(errMsg);
    }
    if (targetElection.state !== 'open' && targetElection.state !== 'draft') {
        Logger.info(ctx, "Ballot Rejected. Election not open.", targetElection);
        throw new BadRequest("Election is not open");
    }

    const reqBody = await body(c);
    const event = await makeBallotEvent(c, targetElection, reqBody.ballot, 'submitted_via_browser');
    event.userEmail = event.roll?.email ?? user(c)?.email ?? reqBody.receiptEmail;

    const eventCtx = Logger.createContext(event.requestId);
    try {
        await ServiceLocator.castVoteStore().submitBallotEvent(event, eventCtx);
    } catch (e: any) {
        if (e.message === "ALREADY_VOTED") {
            Logger.info(ctx, "Ballot Rejected. User has already voted.");
            throw new BadRequest("User has already voted");
        }
        if (e.message === "CONCURRENT_BALLOT_UPDATE_DETECTED" || e.message === "CONCURRENT_ROLL_EDIT_DETECTED") {
            Logger.info(ctx, `Ballot Rejected: ${e.message}`);
            throw new Conflict("Concurrent edit detected, please retry.");
        }
        throw e;
    }

    await (await EventQueue).publish(castVoteEventQueue, event);

    const scrubbedBallot = { ...event.inputBallot, ballot_id: undefined };
    Logger.debug(ctx, "CastVoteController done, saved event to store");
    return c.json({ ballot: scrubbedBallot }, 200);
};

export async function handleCastVoteEvent(job: { id: string; data: CastVoteEvent }): Promise<void> {
    const event = job.data;
    const ctx = Logger.createContext(event.requestId);
    if (event.userEmail) {
        const targetElection = await ElectionsModel.getElectionByID(event.inputBallot.election_id, ctx);
        if (targetElection == null) {
            throw new InternalServerError("Target Election null: " + ctx.contextId);
        }
        const savedBallot = await BallotModel.getBallotByID(event.inputBallot.ballot_id, ctx);
        if (!savedBallot) {
            throw new InternalServerError("Ballot not found: " + event.inputBallot.ballot_id);
        }
        const url = ServiceLocator.globalData().mainUrl;
        const receipt = Receipt(targetElection, event.userEmail, savedBallot, url, event.roll);
        await EmailService.sendEmails([receipt]);
    }
}

function assertVoterMayVote(voterAuthorization: any, election: Election, ctx: ILoggingContext): void {
    Logger.debug(ctx, "assert voter may vote");
    if (voterAuthorization.authorized_voter === false) {
        throw new Unauthorized("User not authorized to vote");
    }
    if (voterAuthorization.has_voted === true && !(election.settings.ballot_updates === true)) {
        throw new BadRequest("User has already voted");
    }
    Logger.debug(ctx, "Voter authorized");
}
