import ServiceLocator from '../../ServiceLocator';
import Logger from '../../Services/Logging/Logger';
import { permissions } from '@equal-vote/star-vote-shared/domain_model/permissions';
import { expectPermission } from "../controllerUtils";
import { BadRequest } from "@curveball/http-errors";
import { Election } from '@equal-vote/star-vote-shared/domain_model/Election';
import { C, body, election, logCtx, userAuth } from "../../honoTypes";

const ElectionsModel = ServiceLocator.electionsDb();
const className = "election.Controllers";

export const setPublicResults = async (c: C) => {
    const ctx = logCtx(c);
    const e: Election = election(c);
    Logger.info(ctx, `${className}.setPublicResults ${e.election_id}`);
    expectPermission(userAuth(c).roles, permissions.canEditElectionState);

    const { public_results, expected_update_date } = await body(c);
    if (typeof public_results !== 'boolean') {
        throw new BadRequest('public_results setting not provided or incorrect type');
    }
    e.settings.public_results = public_results;

    const updatedElection = await ElectionsModel.updateElection(e, ctx, `Publish Results`, expected_update_date);
    if (!updatedElection) {
        const failMsg = 'could not update public_results setting';
        Logger.info(ctx, failMsg);
        throw new BadRequest(failMsg);
    }
    return c.json({ election: updatedElection });
};
