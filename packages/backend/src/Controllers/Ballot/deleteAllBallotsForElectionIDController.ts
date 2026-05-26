import ServiceLocator from "../../ServiceLocator";
import Logger from "../../Services/Logging/Logger";
import { BadRequest } from "@curveball/http-errors";
import { expectPermission } from "../controllerUtils";
import { permissions } from '@equal-vote/star-vote-shared/domain_model/permissions';
import { C, election, logCtx, userAuth } from "../../honoTypes";

const BallotModel = ServiceLocator.ballotsDb();

export const innerDeleteAllBallotsForElectionID = async (c: C) => {
    const ctx = logCtx(c);
    const e = election(c);
    const electionId = e.election_id;

    Logger.debug(ctx, "deleteAllBallotsForElectionID : " + electionId);

    const apiAvailable = e.state === 'draft' || e.public_archive_id !== null;
    if (!apiAvailable) {
        Logger.info(ctx, `Election status, state=${e.state}, public_archive_id=${e.public_archive_id}`);
        throw new BadRequest("Ballots can only be reset while in draft mode or if it's a public_archive election");
    }
    expectPermission(userAuth(c).roles, permissions.canDeleteAllBallots);

    const success = await BallotModel.deleteAllBallotsForElectionID(String(electionId), ctx);
    if (!success) {
        const msg = `Failed to reset ballots for election ${electionId}`;
        Logger.info(ctx, msg);
        throw new BadRequest(msg);
    }
    return success;
};

export const deleteAllBallotsForElectionID = async (c: C) => {
    return c.json({ success: await innerDeleteAllBallotsForElectionID(c) });
};
