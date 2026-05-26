import ServiceLocator from "../../ServiceLocator";
import Logger from "../../Services/Logging/Logger";
import { permissions } from '@equal-vote/star-vote-shared/domain_model/permissions';
import { expectPermission } from "../controllerUtils";
import { BadRequest } from "@curveball/http-errors";
import { C, body, election, logCtx, user, userAuth } from "../../honoTypes";

const ElectionRollModel = ServiceLocator.electionRollDb();
const className = "VoterRolls.Controllers";

export const editElectionRoll = async (c: C) => {
    const ctx = logCtx(c);
    expectPermission(userAuth(c).roles, permissions.canEditElectionRoll);
    const { electionRollEntry: electionRollInput } = await body(c);
    Logger.info(ctx, `${className}.editElectionRoll election:${election(c).election_id}`);
    if (electionRollInput.history == null) electionRollInput.history = [];
    electionRollInput.history.push([{
        action_type: 'edited',
        actor: user(c).email,
        timestamp: Date.now(),
    }]);
    const updated = await ElectionRollModel.update(electionRollInput, ctx, `User Editing Election Roll`);
    if (!updated) {
        const msg = "Election Roll not found";
        Logger.info(ctx, msg);
        throw new BadRequest(msg);
    }
    return c.json(updated, 200);
};
