import { electionValidation } from '@equal-vote/star-vote-shared/domain_model/Election';
import ServiceLocator from '../../ServiceLocator';
import Logger from '../../Services/Logging/Logger';
import { expectPermission } from "../controllerUtils";
import { permissions } from '@equal-vote/star-vote-shared/domain_model/permissions';
import { BadRequest } from "@curveball/http-errors";
import { C, body, logCtx, userAuth } from "../../honoTypes";

const ElectionsModel = ServiceLocator.electionsDb();

export const editElection = async (c: C) => {
    const ctx = logCtx(c);
    const { Election: inputElection, expected_update_date } = await body(c);
    Logger.info(ctx, `editElection: ${inputElection?.election_id}`);
    expectPermission(userAuth(c).roles, permissions.canEditElection);

    const validationErr = electionValidation(inputElection);
    if (validationErr) {
        Logger.info(ctx, `Invalid Election: '${inputElection?.election_id}'` + validationErr);
        throw new BadRequest("Invalid Election: " + validationErr);
    }
    if (inputElection.state !== 'draft' && inputElection.public_archive_id === null) {
        Logger.info(ctx, `Election is not editable, state=${inputElection.state}`);
        throw new BadRequest("Election is not editable");
    }
    if (inputElection.election_id !== c.req.param('id')) {
        Logger.info(ctx, `Body Election ${inputElection.election_id} != param ID ${c.req.param('id')}`);
        throw new BadRequest("Election ID must match the URL Param");
    }

    const updatedElection = await ElectionsModel.updateElection(inputElection, ctx, `User editing draft Election`, expected_update_date);
    if (!updatedElection) {
        const failMsg = `Failed to update election`;
        Logger.error(ctx, failMsg);
        throw new BadRequest(failMsg);
    }
    c.set('election', updatedElection);
    Logger.debug(ctx, `editElection succeeds for ${updatedElection.election_id}`);

    const ua = userAuth(c);
    return c.json({
        election: updatedElection,
        voterAuth: {
            authorized_voter: c.var.authorized_voter,
            has_voted: c.var.has_voted,
            roles: ua.roles,
            permissions: ua.permissions,
        },
    });
};
