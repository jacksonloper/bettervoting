import ServiceLocator from "../../ServiceLocator";
import Logger from "../../Services/Logging/Logger";
import { permissions } from '@equal-vote/star-vote-shared/domain_model/permissions';
import { expectPermission } from "../controllerUtils";
import { BadRequest, Unauthorized } from "@curveball/http-errors";
import { ElectionRoll, ElectionRollAction, ElectionRollResponse } from '@equal-vote/star-vote-shared/domain_model/ElectionRoll';
import { logSafeHash } from '../../Services/Logging/logSafeHash';
import { C, election, logCtx, userAuth } from "../../honoTypes";

const ElectionRollModel = ServiceLocator.electionRollDb();
const EmailEventsModel = ServiceLocator.emailEventsDb();
const className = "VoterRolls.Controllers";

const redactString = (value: string, voterId: string | undefined, shouldRedact: boolean): string => {
    if (!shouldRedact || !voterId) return value;
    if (value.includes(voterId)) return value.replaceAll(voterId, 'Voter');
    return value;
};

const sanitizeHistory = (
    history: ElectionRoll['history'],
    voterId: string | undefined,
    redact: boolean,
): ElectionRoll['history'] => {
    if (!history) return history;
    return history.map((entry: any) => {
        if (Array.isArray(entry)) return sanitizeHistory(entry as ElectionRollAction[], voterId, redact);
        if (entry && typeof entry === 'object') {
            const { email_data: _omit, ...rest } = entry;
            if (typeof rest.action_type === 'string') rest.action_type = redactString(rest.action_type, voterId, redact);
            if (typeof rest.actor === 'string') rest.actor = redactString(rest.actor, voterId, redact);
            return rest;
        }
        if (typeof entry === 'string') return redactString(entry, voterId, redact);
        return entry;
    });
};

const sanitizeEmailMetadata = (
    emailData: ElectionRoll['email_data'],
    voterId: string | undefined,
    redact: boolean,
) => {
    if (!emailData) return emailData;
    const filterResponse = (response: any): any => {
        if (Array.isArray(response)) {
            const filtered = response.map(filterResponse).filter((item) => item !== undefined);
            return filtered.length > 0 ? filtered : undefined;
        }
        if (response && typeof response === 'object') {
            const sanitized: Record<string, any> = {};
            if (typeof response.statusCode === 'number') sanitized.statusCode = response.statusCode;
            if (typeof response.status === 'string') sanitized.status = response.status;
            if (typeof response.error === 'string') sanitized.error = response.error;
            if (typeof response.Error === 'string') sanitized.Error = response.Error;
            if (typeof response.code === 'number') sanitized.code = response.code;
            if (typeof response.message === 'string') sanitized.message = redactString(response.message, voterId, redact);
            if (typeof response.body === 'string') sanitized.body = redactString(response.body, voterId, redact);
            return Object.keys(sanitized).length > 0 ? sanitized : undefined;
        }
        if (typeof response === 'string') {
            const redacted = redactString(response, voterId, redact);
            return redacted.length > 0 ? redacted : undefined;
        }
        return undefined;
    };
    const sanitized: Record<string, any> = {};
    if (emailData.inviteResponse !== undefined) {
        const filtered = filterResponse(emailData.inviteResponse);
        if (filtered !== undefined) sanitized.inviteResponse = filtered;
    }
    if (emailData.reminderResponse !== undefined) {
        const filtered = filterResponse(emailData.reminderResponse);
        if (filtered !== undefined) sanitized.reminderResponse = filtered;
    }
    return Object.keys(sanitized).length > 0 ? sanitized : undefined;
};

export const getRollsByElectionID = async (c: C) => {
    const ctx = logCtx(c);
    const e = election(c);
    expectPermission(userAuth(c).roles, permissions.canViewElectionRoll);
    if (e.settings.voter_access === 'open') {
        throw new Unauthorized("Can't view voter roll for open elections");
    }
    const electionId = e.election_id;
    Logger.info(ctx, `${className}.getRollsByElectionID ${electionId}`);

    const electionRoll = await ElectionRollModel.getRollsByElectionID(electionId, ctx);
    if (!electionRoll) {
        const msg = `Election roll for ${electionId} not found`;
        Logger.info(ctx, msg);
        throw new BadRequest(msg);
    }

    const emailEventsByVoter: Record<string, { event_type: string; event_timestamp: string; details?: Record<string, unknown> }[]> = {};
    try {
        const allEvents = await EmailEventsModel.getByElectionId(electionId, ctx);
        for (const event of allEvents) {
            if (!emailEventsByVoter[event.voter_id]) emailEventsByVoter[event.voter_id] = [];
            emailEventsByVoter[event.voter_id].push({
                event_type: event.event_type,
                event_timestamp: event.event_timestamp,
                details: event.details,
            });
        }
    } catch (err: any) {
        Logger.warn(ctx, `Could not fetch email events: ${err.message}`);
    }

    const redactVoterIds = e.settings.invitation === 'email';
    const scrubbedRoll = electionRoll.map((roll) => {
        const sanitizedHistory = sanitizeHistory(roll.history, roll.voter_id, redactVoterIds);
        const sanitizedEmailData = redactVoterIds ? sanitizeEmailMetadata(roll.email_data, roll.voter_id, redactVoterIds) : roll.email_data;
        const voterEvents = emailEventsByVoter[roll.voter_id] ?? [];
        const base: Partial<ElectionRollResponse> = {
            ...roll,
            ballot_id: undefined,
            ip_hash: undefined,
            history: sanitizedHistory,
            email_data: sanitizedEmailData,
            email_events: voterEvents,
        };
        if (redactVoterIds) delete base.voter_id;
        return base;
    });

    Logger.info(ctx, `${className}.returnRolls ${c.req.param('id')}`);
    return c.json({ election: e, electionRoll: scrubbedRoll });
};

export const getByVoterID = async (c: C) => {
    const ctx = logCtx(c);
    const e = election(c);
    const voter_id = c.req.param('voter_id')!;
    Logger.info(ctx, `${className}.getByVoterID ${e.election_id} ${logSafeHash(voter_id)}`);
    const entry = await ElectionRollModel.getByVoterID(e.election_id, voter_id, ctx);
    if (!entry) {
        const msg = "Voter Roll not found";
        Logger.info(ctx, msg);
        throw new BadRequest(msg);
    }
    const redactVoterIds = e.settings.invitation === 'email';
    const scrubbed: ElectionRoll = {
        ...entry,
        ballot_id: undefined,
        ip_hash: undefined,
        history: sanitizeHistory(entry.history, entry.voter_id, redactVoterIds),
        email_data: redactVoterIds ? sanitizeEmailMetadata(entry.email_data, entry.voter_id, redactVoterIds) : entry.email_data,
    };
    if (redactVoterIds) delete (scrubbed as any).voter_id;
    return c.json({ electionRollEntry: scrubbed });
};
