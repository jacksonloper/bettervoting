import ServiceLocator from '../../ServiceLocator';
import Logger from '../../Services/Logging/Logger';
import { permissions } from '@equal-vote/star-vote-shared/domain_model/permissions';
import { expectPermission } from "../controllerUtils";
import { BadRequest } from "@curveball/http-errors";
import { C, election, logCtx, userAuth } from "../../honoTypes";

const ElectionsModel = ServiceLocator.electionsDb();
const className = "Elections.Controllers";

export const deleteElection = async (c: C) => {
    const ctx = logCtx(c);
    expectPermission(userAuth(c).roles, permissions.canDeleteElection);
    const electionId = election(c).election_id;
    Logger.info(ctx, `${className}.deleteElection ${electionId}`);
    const success = await ElectionsModel.delete(electionId, ctx, `User manually deleting election`);
    if (!success) {
        const msg = "Nothing to delete";
        Logger.error(ctx, msg);
        throw new BadRequest(msg);
    }
    Logger.info(ctx, `Deleted election ${electionId}`);
    return c.text('Election Deleted', 200);
};
