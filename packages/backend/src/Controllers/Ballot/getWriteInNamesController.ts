import ServiceLocator from "../../ServiceLocator";
import Logger from "../../Services/Logging/Logger";
import { expectPermission } from "../controllerUtils";
import { permissions } from '@equal-vote/star-vote-shared/domain_model/permissions';
import { Ballot } from "@equal-vote/star-vote-shared/domain_model/Ballot";
import { WriteInData } from "@equal-vote/star-vote-shared/domain_model/WriteIn";
import { C, election, logCtx, userAuth } from "../../honoTypes";

const BallotModel = ServiceLocator.ballotsDb();

export const getWriteInNamesController = async (c: C) => {
    const ctx = logCtx(c);
    const e = election(c);
    const electionId = e.election_id;
    Logger.debug(ctx, "getWriteInNames: " + electionId);

    expectPermission(userAuth(c).roles, permissions.canViewBallots);

    const ballots = await BallotModel.getBallotsByElectionID(String(electionId), ctx);

    const write_in_data: WriteInData[] = [];
    for (let race_index = 0; race_index < e.races.length; race_index++) {
        if (!e.races[race_index].enable_write_in) continue;
        const race_id = e.races[race_index].race_id;
        const write_in_result: WriteInData = { race_id, names: {} };

        ballots.forEach((ballot: Ballot) => {
            const vote = ballot.votes.find((v) => v.race_id === race_id);
            if (vote) {
                vote.scores.forEach(score => {
                    if (score.write_in_name) {
                        write_in_result.names[score.write_in_name] =
                            (write_in_result.names[score.write_in_name] ?? 0) + 1;
                    }
                });
            }
        });
        write_in_data.push(write_in_result);
    }

    return c.json({ write_in_data });
};
