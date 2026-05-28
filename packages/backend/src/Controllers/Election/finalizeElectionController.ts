import ServiceLocator from '../../ServiceLocator';
import Logger from '../../Services/Logging/Logger';
import { permissions } from '@equal-vote/star-vote-shared/domain_model/permissions';
import { expectPermission } from "../controllerUtils";
import { BadRequest } from "@curveball/http-errors";
import { ElectionRoll } from '@equal-vote/star-vote-shared/domain_model/ElectionRoll';
import { C, body, election, logCtx, userAuth } from "../../honoTypes";
import { innerDeleteAllBallotsForElectionID } from '../Ballot';

const ElectionsModel = ServiceLocator.electionsDb();
const ElectionRollModel = ServiceLocator.electionRollDb();
const className = "election.Controllers";

export const finalizeElection = async (c: C) => {
    const ctx = logCtx(c);
    const e = election(c);
    Logger.info(ctx, `${className}.finalize ${e.election_id}`);
    expectPermission(userAuth(c).roles, permissions.canEditElectionState);

    if (e.state !== 'draft') {
        const msg = "Election already finalized";
        Logger.info(ctx, msg);
        throw new BadRequest(msg);
    }

    const electionId = e.election_id;
    let electionRoll: ElectionRoll[] | null = null;
    if (e.settings.voter_access === 'closed' && e.settings.invitation === 'email') {
        electionRoll = await ElectionRollModel.getRollsByElectionID(electionId, ctx);
        if (!electionRoll) {
            const msg = `Election roll for ${electionId} not found`;
            Logger.info(ctx, msg);
            throw new BadRequest(msg);
        }
    }

    const { expected_update_date } = await body(c);
    // Use a finalized copy for the OC-protected update; leave c.var.election in draft state
    // so the subsequent ballot-deletion's draft-state guard still passes.
    const finalizedElection = { ...e, state: 'finalized' as const };
    const updatedElection = await ElectionsModel.updateElection(finalizedElection, ctx, `Finalizing election`, expected_update_date);
    if (!updatedElection) {
        const failMsg = "Failed to update Election";
        Logger.info(ctx, failMsg);
        throw new BadRequest(failMsg);
    }

    await innerDeleteAllBallotsForElectionID(c);

    return c.json({ election: updatedElection });
};
