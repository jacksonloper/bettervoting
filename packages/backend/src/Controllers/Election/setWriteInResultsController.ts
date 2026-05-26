import ServiceLocator from '../../ServiceLocator';
import Logger from '../../Services/Logging/Logger';
import { permissions } from '@equal-vote/star-vote-shared/domain_model/permissions';
import { expectPermission } from "../controllerUtils";
import { BadRequest, InternalServerError } from "@curveball/http-errors";
import { WriteInCandidate } from '@equal-vote/star-vote-shared/domain_model/WriteIn';
import { trimLower } from '@equal-vote/star-vote-shared/domain_model/Util';
import { C, body, election, logCtx, userAuth } from "../../honoTypes";

const ElectionsModel = ServiceLocator.electionsDb();

const MAX_WRITE_IN_CANDIDATES = 100;
const MAX_CANDIDATE_NAME_LENGTH = 100;
const MAX_ALIASES_PER_CANDIDATE = 20;
const MAX_ALIAS_LENGTH = 100;

function validateWriteInCandidates(candidates: unknown[]): WriteInCandidate[] {
    if (candidates.length > MAX_WRITE_IN_CANDIDATES) {
        throw new BadRequest(`Too many write-in candidates (max ${MAX_WRITE_IN_CANDIDATES})`);
    }
    const result: WriteInCandidate[] = [];
    for (const c of candidates) {
        if (typeof c !== 'object' || c === null) {
            throw new BadRequest('Each write_in_candidate must be an object');
        }
        const obj = c as Record<string, unknown>;
        if (typeof obj.candidate_name !== 'string' || !obj.candidate_name.trim()) {
            throw new BadRequest('Each write_in_candidate must have a non-empty candidate_name string');
        }
        if (obj.candidate_name.length > MAX_CANDIDATE_NAME_LENGTH) {
            throw new BadRequest(`candidate_name exceeds max length of ${MAX_CANDIDATE_NAME_LENGTH}`);
        }
        if (typeof obj.approved !== 'boolean') {
            throw new BadRequest('Each write_in_candidate must have a boolean approved field');
        }
        if (!Array.isArray(obj.aliases) || !obj.aliases.every((a: unknown) => typeof a === 'string')) {
            throw new BadRequest('Each write_in_candidate must have an aliases array of strings');
        }
        if (obj.aliases.length > MAX_ALIASES_PER_CANDIDATE) {
            throw new BadRequest(`Too many aliases for "${obj.candidate_name}" (max ${MAX_ALIASES_PER_CANDIDATE})`);
        }
        if ((obj.aliases as string[]).some((a: string) => a.length > MAX_ALIAS_LENGTH)) {
            throw new BadRequest(`Alias exceeds max length of ${MAX_ALIAS_LENGTH}`);
        }
        result.push({
            candidate_name: obj.candidate_name.trim(),
            approved: obj.approved,
            aliases: (obj.aliases as string[]).map((a: string) => a.trim()).filter(Boolean),
        });
    }
    return result;
}

export const setWriteInResults = async (c: C) => {
    const ctx = logCtx(c);
    const e = election(c);
    Logger.info(ctx, `setWriteInResults ${e.election_id}`);
    expectPermission(userAuth(c).roles, permissions.canProcessWriteIns);

    const { write_in_results } = await body(c);
    if (typeof write_in_results !== 'object') {
        throw new BadRequest('write_in_results not provided or incorrect type');
    }
    if (!write_in_results.race_id || typeof write_in_results.race_id !== 'string') {
        throw new BadRequest('write_in_results.race_id is required');
    }
    if (!Array.isArray(write_in_results.write_in_candidates)) {
        throw new BadRequest('write_in_results.write_in_candidates must be an array');
    }

    const validatedCandidates = validateWriteInCandidates(write_in_results.write_in_candidates);

    // Server-side dedup check: reject if two incoming candidates trim-lowercase to same key
    const incomingKeys = new Set<string>();
    for (const cand of validatedCandidates) {
        const key = trimLower(cand.candidate_name);
        if (incomingKeys.has(key)) {
            throw new BadRequest(`Duplicate candidate name: "${cand.candidate_name}"`);
        }
        incomingKeys.add(key);
    }

    const election_id = e.election_id;

    // Read the current election and note its update_date
    const current = await ElectionsModel.getElectionByID(election_id, ctx);
    if (!current) {
        throw new InternalServerError(`Election ${election_id} not found`);
    }
    const expected_update_date = current.update_date as string;

    const race_index = current.races.findIndex(r => r.race_id === write_in_results.race_id);
    if (race_index === -1) {
        throw new BadRequest('Invalid Race ID');
    }
    if (!current.races[race_index].enable_write_in) {
        throw new BadRequest('Write-In not enabled for this race');
    }
    current.races[race_index].write_in_candidates = validatedCandidates;

    const updatedElection = await ElectionsModel.updateElection(
        current,
        ctx,
        'Update Write-In Candidates',
        expected_update_date
    );
    return c.json({ election: updatedElection });
};
