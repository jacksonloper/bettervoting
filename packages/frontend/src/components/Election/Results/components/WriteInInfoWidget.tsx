import { Box, Chip, Stack, Typography } from "@mui/material";
import useRace from "~/components/RaceContextProvider";
import Widget from "./Widget";

export default function WriteInInfoWidget() {
    const { race, results } = useRace();

    const writeInCandidates = race.write_in_candidates || [];
    const numUnprocessed = results.numUnprocessedWriteIns || 0;

    if (!race.enable_write_in || (writeInCandidates.length === 0 && numUnprocessed === 0)) {
        return null;
    }

    return (
        <Widget title="Write-In Candidates">
            <Box sx={{ textAlign: 'left', p: 2 }}>
                {writeInCandidates.filter(wc => wc.approved).length > 0 && (
                    <Box sx={{ mb: 3 }}>
                        <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mb: 1 }}>
                            Approved Write-In Candidates
                        </Typography>
                        <Stack spacing={2}>
                            {writeInCandidates.filter(wc => wc.approved).map((candidate, index) => (
                                <Box key={index}>
                                    <Typography variant="body1" sx={{ fontWeight: 'bold' }}>
                                        {candidate.candidate_name}
                                    </Typography>
                                    {candidate.aliases.length > 0 && (
                                        <Box sx={{ mt: 0.5, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                            <Typography variant="caption" sx={{ mr: 1, alignSelf: 'center' }}>
                                                Also matches:
                                            </Typography>
                                            {candidate.aliases.map((alias, aliasIndex) => (
                                                <Chip
                                                    key={aliasIndex}
                                                    label={alias}
                                                    size="small"
                                                    variant="outlined"
                                                />
                                            ))}
                                        </Box>
                                    )}
                                </Box>
                            ))}
                        </Stack>
                    </Box>
                )}

                {numUnprocessed > 0 && (
                    <Box>
                        <Typography variant="subtitle1" sx={{ fontWeight: 'bold', color: 'error.main' }}>
                            Unmatched Write-Ins: {numUnprocessed}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                            These write-in votes did not match any approved candidate and were not counted.
                        </Typography>
                    </Box>
                )}
            </Box>
        </Widget>
    );
}
