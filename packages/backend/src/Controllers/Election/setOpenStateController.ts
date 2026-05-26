import ServiceLocator from '../../ServiceLocator';
import Logger from '../../Services/Logging/Logger';
import { permissions } from '@equal-vote/star-vote-shared/domain_model/permissions';
import { expectPermission } from "../controllerUtils";
import { BadRequest, InternalServerError } from "@curveball/http-errors";
import { Election } from '@equal-vote/star-vote-shared/domain_model/Election';
import { C, body, election, logCtx, userAuth } from "../../honoTypes";

const ElectionsModel = ServiceLocator.electionsDb();
const className = "election.Controllers";

export const setOpenState = async (c: C) => {
    const ctx = logCtx(c);
    const e: Election = election(c);
    Logger.info(ctx, `${className}.setOpenState ${e.election_id}`);
    expectPermission(userAuth(c).roles, permissions.canEditElectionState);

    const { open, expected_update_date } = await body(c);

    let msg: string | undefined;
    if (typeof open !== 'boolean') {
        msg = "open setting not provided or incorrect type";
    } else if (e.state !== 'closed' && e.state !== 'open') {
        msg = "Cannot close/open an election that is not open or closed";
    } else if (open && e.state === 'open') {
        msg = "Cannot open an election that is already open";
    } else if (!open && e.state === 'closed') {
        msg = "Cannot close an election that is already closed";
    } else if (e.start_time || e.end_time) {
        msg = "Cannot open or close an election with scheduled start and end times";
    }
    e.state = open ? "open" : "closed";

    if (msg) {
        Logger.info(ctx, msg);
        throw new BadRequest(msg);
    }

    const updatedElection = await ElectionsModel.updateElection(e, ctx, "Open or close election", expected_update_date);
    if (!updatedElection) {
        const failMsg = `Failed to set election state to ${e.state}`;
        Logger.info(ctx, failMsg);
        throw new InternalServerError(failMsg);
    }
    return c.json({ election: updatedElection }, 200);
};
