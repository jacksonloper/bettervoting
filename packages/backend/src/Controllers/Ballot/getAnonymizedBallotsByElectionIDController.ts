import ServiceLocator from "../../ServiceLocator";
import Logger from "../../Services/Logging/Logger";
import { Unauthorized } from "@curveball/http-errors";
import { expectPermission, secureShuffle } from "../controllerUtils";
import { permissions } from '@equal-vote/star-vote-shared/domain_model/permissions';
import { AnonymizedBallot } from "@equal-vote/star-vote-shared/domain_model/Ballot";
import { C, election, logCtx, userAuth } from "../../honoTypes";

const BallotModel = ServiceLocator.ballotsDb();

export const getAnonymizedBallotsByElectionID = async (c: C) => {
    const ctx = logCtx(c);
    const e = election(c);
    const electionId = e.election_id;
    Logger.debug(ctx, "getAnonymizedBallotsByElectionID: " + electionId);

    if (!e.settings.public_results) {
        if (e.state !== 'closed') {
            const msg = `Ballot access only permited when public results are enabled or election has closed`;
            Logger.info(ctx, msg);
            throw new Unauthorized(msg);
        }
        expectPermission(userAuth(c).roles, permissions.canViewBallots);
    }

    const ballots = await BallotModel.getBallotsByElectionID(String(electionId), ctx);
    const anonymizedBallots: AnonymizedBallot[] = ballots
        .filter(ballot => ballot.status === "submitted" && ballot.head)
        .map((ballot) => ({
            ballot_id: ballot.ballot_id,
            election_id: ballot.election_id,
            precinct: ballot.precinct,
            votes: ballot.votes,
        }));
    const shuffledBallots = secureShuffle(anonymizedBallots);
    Logger.debug(ctx, "ballots = ", shuffledBallots);
    return c.json({ ballots: shuffledBallots });
};
