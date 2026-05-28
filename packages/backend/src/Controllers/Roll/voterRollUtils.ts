import { Election } from "@equal-vote/star-vote-shared/domain_model/Election";
import { ElectionRoll, ElectionRollState, NewElectionRoll } from "@equal-vote/star-vote-shared/domain_model/ElectionRoll";
import ServiceLocator from "../../ServiceLocator";
import Logger from "../../Services/Logging/Logger";
import { InternalServerError, Unauthorized } from "@curveball/http-errors";
import type { ILoggingContext } from "../../Services/Logging/ILogger";
import { hashString } from "../controllerUtils";
import { logSafeHash } from "../../Services/Logging/logSafeHash";
import { makeUniqueID, ID_LENGTHS, ID_PREFIXES } from "@equal-vote/star-vote-shared/utils/makeID";
import { C, cookie as readCookie, user as readUser } from "../../honoTypes";

const ElectionRollModel = ServiceLocator.electionRollDb();

// Extract the per-request inputs voter logic needs. Each call rederives from
// the Hono context so callers can either pass a Context (the common case) or
// a synthesized inputs bag (background jobs replaying a request).
export type VoterInputs = {
    ip: string;
    user: any | null;
    voterIdCookie: string | undefined;
    ctx: ILoggingContext;
};

export function inputsFromContext(c: C): VoterInputs {
    const ip =
        c.req.header('x-nf-client-connection-ip') ??
        c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
        '';
    return {
        ip,
        user: readUser(c),
        voterIdCookie: readCookie(c, 'voter_id'),
        ctx: c.var.logCtx,
    };
}

export async function getOrCreateElectionRoll(
    inputs: VoterInputs,
    election: Election,
    voter_id_override?: string,
    skipStateCheck?: boolean,
): Promise<ElectionRoll | null> {
    const { ip, user, voterIdCookie, ctx } = inputs;
    Logger.info(ctx, `getOrCreateElectionRoll`);
    const ip_hash = hashString(ip);
    const require_ip_hash = (election.settings.voter_authentication.ip_address ? ip_hash : null) ?? null;
    const email = election.settings.voter_authentication.email ? user?.email : null;

    let voter_id: string | null = null;
    if (election.settings.voter_authentication.voter_id && election.settings.voter_access === 'closed') {
        // cookies don't support special characters — value is base64.
        voter_id = voter_id_override ?? (voterIdCookie ? atob(voterIdCookie) : null);
    } else if (election.settings.voter_authentication.voter_id && election.settings.voter_access === 'open') {
        voter_id = voter_id_override ?? user?.sub;
    }

    let electionRollEntries = null;
    if (require_ip_hash || email || voter_id) {
        electionRollEntries = await ElectionRollModel.getElectionRoll(String(election.election_id), voter_id, email, require_ip_hash, ctx);
    }

    if (electionRollEntries == null) {
        if (election.settings.voter_access !== 'open') return null;
        if (!skipStateCheck && election.state !== 'open') return null;

        Logger.info(ctx, "Creating new roll");
        const new_voter_id = election.settings.voter_authentication.voter_id
            ? voter_id
            : await makeUniqueID(
                ID_PREFIXES.VOTER,
                ID_LENGTHS.VOTER,
                async (id: string) => await ElectionRollModel.getByVoterID(String(election.election_id), id, ctx) !== null,
            );
        const history = [{
            action_type: ElectionRollState.approved,
            actor: new_voter_id!,
            timestamp: Date.now(),
        }];
        const roll: NewElectionRoll[] = [{
            election_id: String(election.election_id),
            email: user?.email ? user.email : undefined,
            voter_id: new_voter_id!,
            ip_hash: ip_hash!,
            submitted: false,
            state: ElectionRollState.approved,
            history,
        }];
        if (require_ip_hash || email || voter_id) {
            const inserted = await ElectionRollModel.submitElectionRoll(roll, ctx, `User requesting Roll and is authorized`);
            return inserted[0];
        } else {
            return { ...roll[0], update_date: Date.now().toString(), head: true, create_date: new Date().toISOString() };
        }
    }

    if (electionRollEntries.length > 1) {
        Logger.error(ctx, `Multiple election roll entries found (${electionRollEntries.length} entries)`);
        throw new InternalServerError('Multiple election roll entries found');
    }
    if (election.settings.voter_authentication.ip_address && electionRollEntries[0].ip_hash) {
        if (electionRollEntries[0].ip_hash !== ip_hash) {
            Logger.error(ctx, `IP Address does not match saved voter roll, voter: ${logSafeHash(electionRollEntries[0].voter_id)}`);
            throw new Unauthorized('IP Address does not match saved voter roll');
        }
    }
    if (election.settings.voter_authentication.email && electionRollEntries[0].email !== email) {
        Logger.error(ctx, `Email does not match saved election roll, voter: ${logSafeHash(electionRollEntries[0].voter_id)}`);
        throw new Unauthorized('Email does not match saved election roll');
    }
    if (election.settings.voter_authentication.voter_id && electionRollEntries[0].voter_id.trim() !== voter_id?.trim()) {
        Logger.error(ctx, `Voter ID does not match saved election roll, voter: ${logSafeHash(electionRollEntries[0].voter_id)}`);
        throw new Unauthorized('Voter ID does not match saved voter roll');
    }

    return electionRollEntries[0];
}

export function checkForMissingAuthenticationData(inputs: VoterInputs, election: Election, voter_id?: string): string | null {
    const { user, voterIdCookie, ctx } = inputs;
    Logger.info(ctx, `checkForMissingAuthenticationData`);
    if ((election.settings.voter_authentication.voter_id && election.settings.voter_access === 'closed') && !(voter_id ?? voterIdCookie)) {
        return 'Voter ID Required for closed elections';
    }
    if ((election.settings.voter_authentication.voter_id && election.settings.voter_access === 'open') && !user) {
        return "Temp ID is required for open elections with 'one vote per device' authentication";
    }
    if (election.settings.voter_authentication.email && !user?.email) {
        return 'Email Validation Required';
    }
    return null;
}

export function getVoterAuthorization(roll: ElectionRoll | null, missingAuthData: string | null) {
    Logger.info(undefined, `getVoterAuthorization`);
    if (missingAuthData !== null) {
        Logger.info(undefined, missingAuthData);
        return { authorized_voter: false, required: missingAuthData, has_voted: false };
    }
    if (roll === null) {
        return { authorized_voter: false, has_voted: false };
    }
    return { authorized_voter: true, has_voted: roll.submitted };
}
