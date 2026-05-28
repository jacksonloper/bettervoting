import ServiceLocator from "../../ServiceLocator";
import Logger from "../../Services/Logging/Logger";
import { permissions } from '@equal-vote/star-vote-shared/domain_model/permissions';
import { expectPermission } from "../controllerUtils";
import { BadRequest } from "@curveball/http-errors";
import { logSafeHash } from "../../Services/Logging/logSafeHash";
import { C, body, election, logCtx, user, userAuth } from "../../honoTypes";

const ElectionRollModel = ServiceLocator.electionRollDb();
const className = "VoterRolls.Controllers";

/**
 * EMERGENCY "BREAK GLASS" ENDPOINT
 * This endpoint reveals the voter_id associated with an email address.
 * It creates a prominent audit log entry that includes:
 * - Who performed the action (actor user ID)
 * - Which voter's ID was revealed (email address)
 * - When the action was performed
 *
 * This should only be used in emergency situations where an admin needs
 * to send a unique voting URL to a voter.
 */
export const revealVoterIdByEmail = async (c: C) => {
    const ctx = logCtx(c);
    const e = election(c);
    const electionId = e.election_id;
    const { email } = await body(c);

    if (!email || typeof email !== 'string') {
        throw new BadRequest('Email address is required');
    }

    const redactVoterIds = e.settings?.invitation === 'email';
    if (!redactVoterIds) {
        throw new BadRequest('Reveal voter ID is only available for email list elections');
    }

    expectPermission(userAuth(c).roles, permissions.canViewElectionRoll);

    const actor = user(c)?.email || 'unknown';

    Logger.error(ctx, `BREAK GLASS ACTION - ${className}.revealVoterIdByEmail - Election: ${electionId}, Email: ${logSafeHash(email)}, Actor: ${logSafeHash(actor)}`);

    const electionRoll = await ElectionRollModel.getRollsByElectionID(electionId, ctx);
    if (!electionRoll) {
        const msg = `Election roll for ${electionId} not found`;
        Logger.info(ctx, msg);
        throw new BadRequest(msg);
    }

    const rollEntry = electionRoll.find(roll => roll.email?.toLowerCase() === email.toLowerCase());
    if (!rollEntry) {
        const msg = `No voter found with email ${logSafeHash(email)}`;
        Logger.info(ctx, msg);
        throw new BadRequest(msg);
    }

    rollEntry.history = rollEntry.history || [];
    rollEntry.history.push({
        action_type: '🚨 VOTER_ID_REVEALED',
        actor,
        timestamp: Date.now(),
    });

    await ElectionRollModel.update(rollEntry, ctx, '🚨 VOTER_ID_REVEALED');

    Logger.error(ctx, `BREAK GLASS COMPLETED - ${className}.revealVoterIdByEmail - Election: ${electionId}, VoterID: ${logSafeHash(rollEntry.voter_id)}, Email: ${logSafeHash(email)}`);

    return c.json({
        voter_id: rollEntry.voter_id,
        email: rollEntry.email,
        warning: 'This action has been logged in the audit trail',
    });
};
