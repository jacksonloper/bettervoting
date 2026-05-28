import { ElectionRoll, ElectionRollState, NewElectionRoll } from "@equal-vote/star-vote-shared/domain_model/ElectionRoll";
import ServiceLocator from "../../ServiceLocator";
import Logger from "../../Services/Logging/Logger";
import { permissions } from '@equal-vote/star-vote-shared/domain_model/permissions';
import { expectPermission } from "../controllerUtils";
import { BadRequest } from "@curveball/http-errors";
import { sharedConfig } from "@equal-vote/star-vote-shared/config";
import { makeUniqueID, ID_LENGTHS, ID_PREFIXES } from "@equal-vote/star-vote-shared/utils/makeID";
import { C, body, election, logCtx, user, userAuth } from "../../honoTypes";

interface ElectionRollInput {
    voter_id?: string;
    email?: string;
    precinct?: string;
    state?: ElectionRollState;
}

const ElectionRollModel = ServiceLocator.electionRollDb();
const className = "VoterRolls.Controllers";

export const addElectionRoll = async (c: C) => {
    const ctx = logCtx(c);
    const e = election(c);
    expectPermission(userAuth(c).roles, permissions.canAddToElectionRoll);
    Logger.info(ctx, `${className}.addElectionRoll ${e.election_id}`);

    const reqBody = await body(c);
    // Filter out empty roll entries (where all fields are empty)
    const electionRollFiltered: ElectionRollInput[] = reqBody.electionRoll.filter((rollInput: ElectionRollInput) => {
        return rollInput.voter_id?.trim() || rollInput.email?.trim() || rollInput.precinct?.trim();
    });

    // Prevent creating voters by voter_id when using email invitations
    if (e.settings.invitation === 'email') {
        const hasVoterId = electionRollFiltered.some((r) => r.voter_id);
        if (hasVoterId) {
            throw new BadRequest('Cannot create voters with voter_id when using email invitations');
        }
    }

    const history = [{
        action_type: "added",
        actor: user(c).email,
        timestamp: Date.now(),
    }];
    if (e.settings.invitation === "email" && electionRollFiltered.some((r) => r.voter_id)) {
        throw new BadRequest("User provided voterIds are not permitted for email list elections");
    }

    const idPromises: Promise<string>[] = electionRollFiltered.map((rollInput) =>
        rollInput.voter_id
            ? Promise.resolve(rollInput.voter_id)
            : makeUniqueID(
                ID_PREFIXES.VOTER,
                ID_LENGTHS.VOTER,
                async (id: string) => await ElectionRollModel.getByVoterID(e.election_id, id, ctx) !== null,
            ),
    );
    const voterIds = await Promise.all(idPromises);

    const rolls: NewElectionRoll[] = electionRollFiltered.map((rollInput, index) => ({
        voter_id: voterIds[index],
        election_id: e.election_id,
        email: rollInput.email,
        submitted: false,
        precinct: rollInput.precinct,
        state: rollInput.state || ElectionRollState.approved,
        history,
    }));

    const existingRolls = await ElectionRollModel.getRollsByElectionID(e.election_id, ctx);
    if (existingRolls) {
        const duplicateRolls = electionRollFiltered.filter((roll) =>
            existingRolls.some(existingRoll => {
                if (existingRoll.email && roll.email && existingRoll.email === roll.email) return true;
                if (existingRoll.voter_id && roll.voter_id && existingRoll.voter_id === roll.voter_id) return true;
                return false;
            }),
        );
        if (duplicateRolls.length > 0) {
            throw new BadRequest(`Some submitted voters already exist (${duplicateRolls.length} duplicates found)`);
        }

        const overrides = sharedConfig.ELECTION_VOTER_LIMIT_OVERRIDES as { [key: string]: number };
        const voterLimit = overrides[e.election_id] ?? sharedConfig.FREE_TIER_PRIVATE_VOTER_LIMIT;
        if (e.settings.voter_access === 'closed' && existingRolls.length + electionRollFiltered.length > voterLimit) {
            throw new BadRequest(`Request Denied: this election is limited to ${voterLimit} voters`);
        }
    }

    const newElectionRoll = await ElectionRollModel.submitElectionRoll(rolls, ctx, `User adding Election Roll`);
    return c.json({ election: e, newElectionRoll }, 200);
};
