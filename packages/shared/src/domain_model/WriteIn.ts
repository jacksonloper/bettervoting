import { Uid } from "./Uid";

export interface WriteInCandidate {
    candidate_name: string;
    aliases: string[];
    approved: boolean;
}

export interface WriteInData {
    race_id: Uid,
    names: { [key: string]: number }
}

/**
 * Check if a write-in name matches a candidate's official name or any of their aliases.
 * Matching is case-insensitive and ignores leading/trailing whitespace.
 */
export function matchesWriteInCandidate(writeInName: string, candidate: WriteInCandidate): boolean {
    const normalized = writeInName.trim().toLowerCase();

    // Check official name
    if (candidate.candidate_name.trim().toLowerCase() === normalized) {
        return true;
    }

    // Check aliases
    return candidate.aliases.some(alias => alias.trim().toLowerCase() === normalized);
}