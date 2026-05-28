import { ElectionRollState } from "@equal-vote/star-vote-shared/domain_model/ElectionRoll";
import ServiceLocator from "../../ServiceLocator";
import Logger from "../../Services/Logging/Logger";
import { permission, permissions } from '@equal-vote/star-vote-shared/domain_model/permissions';
import { expectPermission } from "../controllerUtils";
import { InternalServerError, Unauthorized } from "@curveball/http-errors";
import { C, body, election, logCtx, user, userAuth } from "../../honoTypes";

const ElectionRollModel = ServiceLocator.electionRollDb();
const className = "VoterRollState.Controllers";

export const approveElectionRoll = async (c: C) => {
    Logger.info(logCtx(c), `${className}.approveElectionRoll ${c.req.param('id')}`);
    await changeElectionRollState(c, ElectionRollState.approved, [ElectionRollState.registered, ElectionRollState.flagged], permissions.canApproveElectionRoll);
    return c.json({}, 200);
};

export const flagElectionRoll = async (c: C) => {
    Logger.info(logCtx(c), `${className}.flagElectionRoll ${c.req.param('id')}`);
    await changeElectionRollState(c, ElectionRollState.flagged, [ElectionRollState.approved, ElectionRollState.registered, ElectionRollState.invalid], permissions.canFlagElectionRoll);
    return c.json({}, 200);
};

export const invalidateElectionRoll = async (c: C) => {
    Logger.info(logCtx(c), `${className}.invalidateElectionRoll ${c.req.param('id')}`);
    await changeElectionRollState(c, ElectionRollState.invalid, [ElectionRollState.flagged], permissions.canInvalidateBallot);
    return c.json({}, 200);
};

export const uninvalidateElectionRoll = async (c: C) => {
    Logger.info(logCtx(c), `${className}.uninvalidateElectionRoll ${c.req.param('id')}`);
    await changeElectionRollState(c, ElectionRollState.flagged, [ElectionRollState.invalid], permissions.canInvalidateBallot);
    return c.json({}, 200);
};

export const changeElectionRollState = async (c: C, newState: ElectionRollState, validStates: ElectionRollState[], perm: permission) => {
    const ctx = logCtx(c);
    expectPermission(userAuth(c).roles, perm);
    const { electionRollEntry } = await body(c);
    const roll = await ElectionRollModel.getByVoterID(election(c).election_id, electionRollEntry.voter_id, ctx);
    if (!roll) {
        const msg = "Could not find election roll";
        Logger.info(ctx, msg);
        throw new InternalServerError(msg);
    }
    if (!validStates.includes(roll.state)) {
        throw new Unauthorized('Invalid election roll state transition');
    }
    roll.state = newState;
    if (roll.history == null) roll.history = [];
    roll.history.push({
        action_type: newState,
        actor: user(c).email,
        timestamp: Date.now(),
    });
    const updated = await ElectionRollModel.update(roll, ctx, "Changing Election Roll state to " + newState);
    if (!updated) {
        const msg = "Could not change election roll state";
        Logger.error(ctx, "= = = = = = \n = = = = = ");
        Logger.info(ctx, msg);
        throw new InternalServerError(msg);
    }
};
