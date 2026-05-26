import Logger from "../../Services/Logging/Logger";
import { NotImplemented } from "@curveball/http-errors";
import { C, election, logCtx } from "../../honoTypes";

const className = "VoterRolls.Controllers";

export const registerVoter = async (c: C) => {
    Logger.info(logCtx(c), `${className}.registerVoter ${election(c)?.election_id}`);
    // Reachable via POST /API/Election/:id/register, but no frontend code calls it
    // and the implementation was never finished. Failing loudly so we notice if anyone tries.
    throw new NotImplemented("Voter registration is not implemented");
};
