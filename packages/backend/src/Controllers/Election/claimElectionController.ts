import ServiceLocator from '../../ServiceLocator';
import Logger from '../../Services/Logging/Logger';
import { permissions } from '@equal-vote/star-vote-shared/domain_model/permissions';
import { expectPermission, hashString } from "../controllerUtils";
import { Unauthorized } from "@curveball/http-errors";
import { C, body, election, logCtx, user, userAuth } from "../../honoTypes";

const ElectionsModel = ServiceLocator.electionsDb();
const className = "election.Controllers";

export const claimElection = async (c: C) => {
    const ctx = logCtx(c);
    const e = election(c);
    const u = user(c);
    Logger.info(ctx, `${className}.claimElection ${e.election_id}`);
    // temp_id will be verified against the election owner id to grant the owner role
    expectPermission(userAuth(c).roles, permissions.canClaimElection);

    if (e.owner_id === u.sub) return c.body(null);

    if (u.typ !== 'ID') {
        throw new Unauthorized("User does not have permissions: must be logged in");
    }

    const { claim_key, expected_update_date } = await body(c);
    if (hashString(claim_key) !== e.claim_key_hash) {
        throw new Unauthorized("User does not have permissions: claim_key mismatch");
    }

    e.owner_id = u.sub;
    await ElectionsModel.updateElection(e, ctx, `Transferring Ownership`, expected_update_date);
    return c.body(null);
};
