import { Election, electionValidation } from "@equal-vote/star-vote-shared/domain_model/Election";
import Logger from "../Services/Logging/Logger";
import type { ILoggingContext } from "../Services/Logging/ILogger";
import { BadRequest, Unauthorized } from "@curveball/http-errors";
import { roles } from "@equal-vote/star-vote-shared/domain_model/roles";
import { permission } from '@equal-vote/star-vote-shared/domain_model/permissions';
import { createHash, randomInt } from "crypto";
import ServiceLocator from "../ServiceLocator";
import { makeUniqueID, ID_LENGTHS } from "@equal-vote/star-vote-shared/utils/makeID";

const ElectionsModel = ServiceLocator.electionsDb();

export async function expectValidElection(ctx: ILoggingContext, inputElection: any): Promise<Election> {
    inputElection.election_id = await makeUniqueID(
        null,
        ID_LENGTHS.ELECTION,
        async (id: string) => Boolean(await ElectionsModel.electionExistsByID(id, ctx))
    );
    inputElection.create_date = new Date().toISOString();
    const validationErr = electionValidation(inputElection);
    if (validationErr) {
        Logger.info(ctx, "Invalid Election: " + validationErr, inputElection);
        throw new BadRequest("Invalid Election " + validationErr);
    }
    return inputElection;
}

export function expectPermission(roles: roles[], permission: permission): void {
    if (!roles.some((role) => permission.includes(role))) {
        throw new Unauthorized("Does not have permission");
    }
}

// Same util as frontend, but separate because of differing crypto libraries.
export function hashString(inputString: string) {
    if (inputString === undefined) return undefined;
    return createHash('sha256').update(inputString).digest('hex');
}

// Fisher–Yates shuffle using crypto.randomInt so admins can't infer the
// insertion order of ballots or roll entries from the response order — that
// order would otherwise let an admin without DB access correlate ballots to
// voters by submission time.
export function secureShuffle<T>(items: readonly T[]): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
        const j = randomInt(0, i + 1);
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}
