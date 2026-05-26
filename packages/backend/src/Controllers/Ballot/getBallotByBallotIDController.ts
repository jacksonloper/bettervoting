import ServiceLocator from "../../ServiceLocator";
import Logger from "../../Services/Logging/Logger";
import { BadRequest } from "@curveball/http-errors";
import { C, election, logCtx } from "../../honoTypes";

const BallotModel = ServiceLocator.ballotsDb();

export const getBallotByBallotID = async (c: C) => {
    const ctx = logCtx(c);
    const e = election(c);
    const electionId = e.election_id;
    const ballot_id = c.req.param('ballot_id');
    if (!ballot_id) {
        throw new BadRequest('No Ballot ID provided');
    }
    Logger.debug(ctx, "getBallotByBallotID: " + ballot_id);

    const ballot = await BallotModel.getBallotByID(ballot_id, ctx);
    if (!ballot) {
        const msg = `Ballots not found for Election ${electionId}`;
        Logger.info(ctx, msg);
        throw new BadRequest(msg);
    }
    if (electionId !== ballot.election_id) {
        throw new BadRequest('Incorrect Election ID');
    }

    const scrubbedBallot = {
        ...ballot,
        history: undefined,
        date_submitted: undefined,
        create_date: undefined,
        update_date: undefined,
        user_id: undefined,
        ip_hash: undefined,
    };
    Logger.debug(ctx, "ballot = ", scrubbedBallot);
    return c.json({ ballot: scrubbedBallot });
};
