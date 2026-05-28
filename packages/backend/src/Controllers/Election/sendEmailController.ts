import ServiceLocator from '../../ServiceLocator';
import Logger from '../../Services/Logging/Logger';
import { permissions } from '@equal-vote/star-vote-shared/domain_model/permissions';
import { expectPermission } from "../controllerUtils";
import { BadRequest, InternalServerError } from "@curveball/http-errors";
import { makeEmails } from "../../Services/Email/EmailTemplates";
import { ElectionRoll, ElectionRollAction } from '@equal-vote/star-vote-shared/domain_model/ElectionRoll';
import { Uid } from "@equal-vote/star-vote-shared/domain_model/Uid";
import { Election } from '@equal-vote/star-vote-shared/domain_model/Election';
import { randomUUID } from "crypto";
import { Imsg } from '../../Services/Email/IEmail';
import { logSafeHash } from '../../Services/Logging/logSafeHash';
import { C, body, election, logCtx, user, userAuth } from "../../honoTypes";

const ElectionRollModel = ServiceLocator.electionRollDb();
const ElectionModel = ServiceLocator.electionsDb();
const EmailService = ServiceLocator.emailService();
const EmailEventsDB = ServiceLocator.emailEventsDb();
const EventQueue = ServiceLocator.eventQueue();

const className = "election.Controllers";
const SendEmailEventQueue = "sendEmailEvent";

export type email_request_data = {
    voter_id?: string;
    recipient_email?: string;
    email: { subject: string; body: string };
    target: 'all' | 'has_voted' | 'has_not_voted' | 'single' | 'test';
    testEmails?: string[];
};

export type email_request_event = {
    requestId: Uid;
    election_id: string | undefined;
    election: Election | undefined;
    url: string;
    voter_id: string;
    email: { subject: string; body: string };
    message_id: string;
    sender: string;
    test_email: string;
};

const makeTestRoll = (election_id: string, email: string) => <ElectionRoll>{
    voter_id: 'test_voter_id',
    election_id,
    email,
    submitted: false,
    state: 'approved',
    create_date: new Date(),
    update_date: new Date(),
    head: true,
};

export const sendEmailsController = async (c: C) => {
    const ctx = logCtx(c);
    const e = election(c);
    Logger.info(ctx, `${className}.sendEmails ${e.election_id}`);
    expectPermission(userAuth(c).roles, permissions.canSendEmails);

    const electionId = e.election_id;
    const email_request: email_request_data = await body(c);

    if (!(e.settings.voter_access === 'closed' && e.settings.invitation === 'email')) {
        const msg = `Emails not enabled`;
        Logger.info(ctx, msg);
        throw new BadRequest(msg);
    }

    let message_id = '';
    let electionRoll: ElectionRoll[] | null = null;

    if (email_request.target === 'single') {
        let entry: ElectionRoll | null = null;
        if (email_request.voter_id) {
            entry = await ElectionRollModel.getByVoterID(electionId, email_request.voter_id, ctx);
        } else if (email_request.recipient_email) {
            const rolls = await ElectionRollModel.getElectionRoll(electionId, null, email_request.recipient_email, null, ctx);
            if (rolls && rolls.length > 0) {
                if (rolls.length > 1) {
                    Logger.warn(ctx, `Multiple voters found with email ${logSafeHash(email_request.recipient_email)} in election ${electionId}, using first match`);
                }
                entry = rolls[0];
            }
        } else {
            const msg = `Either voter_id or recipient_email is required for single target`;
            Logger.info(ctx, msg);
            throw new BadRequest(msg);
        }
        if (!entry) {
            const msg = `Voter not found`;
            Logger.info(ctx, msg);
            throw new BadRequest(msg);
        }
        electionRoll = [entry];
        message_id = `dm_${email_request.voter_id ?? email_request.recipient_email}_${0}`;
    } else if (email_request.target === 'test') {
        electionRoll = (email_request.testEmails ?? []).map(email => makeTestRoll(e.election_id, email));
    } else {
        electionRoll = await ElectionRollModel.getRollsByElectionID(electionId, ctx);
        if (!electionRoll) {
            const msg = `No voters found`;
            Logger.info(ctx, msg);
            throw new BadRequest(msg);
        }
        if (email_request.target === 'has_not_voted') {
            electionRoll = electionRoll.filter(roll => !roll.submitted);
            if (electionRoll.length === 0) {
                Logger.info(ctx, `All voters have voted`);
                throw new BadRequest(`All voters have voted`);
            }
        } else if (email_request.target === 'has_voted') {
            electionRoll = electionRoll.filter(roll => roll.submitted);
            if (electionRoll.length === 0) {
                Logger.info(ctx, `No voters have voted yet`);
                throw new BadRequest(`No voters have voted yet`);
            }
        }
        e.settings.email_campaign_count = e.settings.email_campaign_count ? e.settings.email_campaign_count + 1 : 1;
        await ElectionModel.updateElection(e, ctx, 'Email Campaign');
        message_id = `campaign_${e.settings.email_campaign_count}`;
    }

    const Jobs: email_request_event[] = [];
    const reqId = ctx.contextId ?? randomUUID();
    const url = ServiceLocator.globalData().mainUrl;
    electionRoll.forEach(roll => {
        Jobs.push({
            requestId: reqId,
            election_id: e.election_id,
            election: undefined,
            url,
            voter_id: roll.voter_id,
            sender: user(c).email,
            email: email_request.email,
            message_id,
            test_email: email_request.target === 'test' ? (roll.email ?? '') : '',
        });
    });

    try {
        await (await EventQueue).publishBatch(SendEmailEventQueue, Jobs);
    } catch (err: any) {
        const msg = `Could not send invitations`;
        Logger.error(ctx, `${msg}: ${err.message}`);
        throw new InternalServerError(`Failed to send invitations`);
    }

    return c.json({});
};

export async function handleSendEmailEvent(job: { id: string; data: email_request_event }): Promise<void> {
    Logger.info(undefined, `${className}.sendEmailEvent`);
    const event = job.data;
    const ctx = Logger.createContext(event.requestId);

    let election: Election | null;
    if (event.election === undefined) {
        election = await ElectionModel.getElectionByID(event.election_id ?? '', ctx);
    } else {
        election = event.election;
    }
    if (election == null) {
        throw new InternalServerError(`Could not find election: ${event.election_id}`);
    }

    const electionRoll = event.test_email !== ''
        ? makeTestRoll(election.election_id, event.test_email)
        : await ElectionRollModel.getByVoterID(election.election_id, event.voter_id, ctx);

    if (!electionRoll) {
        Logger.error(ctx, `Could not find voter ${logSafeHash(event.voter_id)}`);
        throw new InternalServerError('Could not find voter');
    }

    const emails: Imsg[] = makeEmails(election, [electionRoll], event.url, event.email.subject, event.email.body, event.test_email !== '');

    let emailResponse;
    try {
        emailResponse = await EmailService.sendEmails(emails);
    } catch (e) {
        throw new InternalServerError(`Couldn't send email: ${e}`);
    }

    const xMessageId = emailResponse?.[0]?.[0]?.headers?.['x-message-id'];
    if (xMessageId && !event.test_email) {
        try {
            await EmailEventsDB.insert({
                message_id: xMessageId,
                election_id: election.election_id,
                voter_id: event.voter_id,
                event_type: 'sent',
                event_timestamp: new Date().toISOString(),
                details: { status_code: emailResponse?.[0]?.[0]?.statusCode },
            }, ctx);
        } catch (err: any) {
            Logger.error(ctx, `Could not insert email event: ${err.message}`);
        }
    }

    if (event.test_email) return;

    const historyUpdate: ElectionRollAction = {
        action_type: event.message_id,
        actor: event.sender,
        timestamp: Date.now(),
        email_data: emailResponse,
    };
    if (electionRoll.history == null) electionRoll.history = [];
    electionRoll.history.push(historyUpdate);

    try {
        const updated = await ElectionRollModel.update(electionRoll, ctx, `Email Sent`);
        if (!updated) throw new InternalServerError();
    } catch (err: any) {
        const msg = `Could not update election roll`;
        Logger.error(ctx, `${msg}: ${err.message}`);
        throw new InternalServerError(msg);
    }
}
