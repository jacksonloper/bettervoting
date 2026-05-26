import ServiceLocator from '../../ServiceLocator';
import Logger from '../../Services/Logging/Logger';
import { expectPermission } from "../controllerUtils";
import { permissions } from '@equal-vote/star-vote-shared/domain_model/permissions';
import { BadRequest } from "@curveball/http-errors";
import { C, body, election, logCtx, userAuth } from "../../honoTypes";

const ElectionsModel = ServiceLocator.electionsDb();

export const editElectionRoles = async (c: C) => {
    const ctx = logCtx(c);
    const e = election(c);
    Logger.info(ctx, `editElectionRoles: ${e.election_id}`);
    expectPermission(userAuth(c).roles, permissions.canEditElectionRoles);

    const { admin_ids, audit_ids, credential_ids, expected_update_date } = await body(c);
    e.admin_ids = admin_ids;
    e.audit_ids = audit_ids;
    e.credential_ids = credential_ids;

    const updatedElection = await ElectionsModel.updateElection(e, ctx, `Update election roles`, expected_update_date);
    if (!updatedElection) {
        const failMsg = "Failed to update Election roles";
        Logger.info(ctx, failMsg);
        throw new BadRequest(failMsg);
    }

    c.set('election', updatedElection);
    Logger.debug(ctx, `editElectionRoles succeeds for ${updatedElection.election_id}`);
    return c.json({ election: updatedElection }, 200);
};
