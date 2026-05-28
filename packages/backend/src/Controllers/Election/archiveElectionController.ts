import ServiceLocator from '../../ServiceLocator';
import Logger from '../../Services/Logging/Logger';
import { permissions } from '@equal-vote/star-vote-shared/domain_model/permissions';
import { expectPermission } from "../controllerUtils";
import { BadRequest } from "@curveball/http-errors";
import { Election } from '@equal-vote/star-vote-shared/domain_model/Election';
import { C, body, election, logCtx, userAuth } from "../../honoTypes";

const ElectionsModel = ServiceLocator.electionsDb();
const className = "election.Controllers";

export const archiveElection = async (c: C) => {
    const ctx = logCtx(c);
    const e: Election = election(c);
    Logger.info(ctx, `${className}.archive ${e.election_id}`);
    expectPermission(userAuth(c).roles, permissions.canEditElectionState);

    if (e.state === 'archived') {
        const msg = "Election already archived";
        Logger.info(ctx, msg);
        throw new BadRequest(msg);
    }

    e.state = 'archived';
    const { expected_update_date } = await body(c);
    const updatedElection = await ElectionsModel.updateElection(e, ctx, `Archive election`, expected_update_date);
    if (!updatedElection) {
        const failMsg = "Failed to update Election";
        Logger.info(ctx, failMsg);
        throw new BadRequest(failMsg);
    }
    return c.json({ election: updatedElection });
};
