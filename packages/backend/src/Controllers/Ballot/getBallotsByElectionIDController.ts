import ServiceLocator from "../../ServiceLocator";
import Logger from "../../Services/Logging/Logger";
import { Unauthorized } from "@curveball/http-errors";
import { expectPermission, secureShuffle } from "../controllerUtils";
import { permissions } from '@equal-vote/star-vote-shared/domain_model/permissions';
import { C, election, logCtx, userAuth } from "../../honoTypes";

const BallotModel = ServiceLocator.ballotsDb();

export const getBallotsByElectionID = async (c: C) => {
    const ctx = logCtx(c);
    const e = election(c);
    const electionId = e.election_id;
    Logger.debug(ctx, "getBallotsByElectionID: " + electionId);

    expectPermission(userAuth(c).roles, permissions.canViewBallots);
    if (!e.settings.public_results && e.state !== 'closed') {
        const msg = `Ballot access only permited when public results are enabled or election has closed`;
        Logger.info(ctx, msg);
        throw new Unauthorized(msg);
    }

    const ballots = await BallotModel.getBallotsByElectionID(String(electionId), ctx);

    const scrubbedBallots = ballots.map(ballot => ({
        ...ballot,
        history: undefined,
        date_submitted: undefined,
        create_date: undefined,
        update_date: undefined,
        user_id: undefined,
        ip_hash: undefined,
    }));

    const shuffledBallots = secureShuffle(scrubbedBallots);

    Logger.debug(ctx, "ballots = ", shuffledBallots);
    return c.json({ election: e, ballots: shuffledBallots });
};
