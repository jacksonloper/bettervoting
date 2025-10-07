import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    Box,
    Typography,
    Paper,
    Button,
    TextField,
    IconButton,
    Accordion,
    AccordionSummary,
    AccordionDetails,
    List,
    ListItem,
    ListItemText,
    Chip,
    Stack,
    Divider,
    Alert
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import { PrimaryButton } from '../../styles';
import useElection from '../../ElectionContextProvider';
import { useGetWriteInNames, useSetWriteInCandidates } from '../../../hooks/useAPI';
import { WriteInCandidate, matchesWriteInCandidate } from '@equal-vote/star-vote-shared/domain_model/WriteIn';

export default function WriteInProcessing() {
    const { race_id } = useParams<{ race_id: string }>();
    const { election, refreshElection } = useElection();
    const election_id = election.election_id;
    const navigate = useNavigate();

    const { data: writeInData, isPending: isLoading, makeRequest: fetchWriteIns } = useGetWriteInNames(election_id);
    const { makeRequest: saveWriteIns, isPending: isSaving } = useSetWriteInCandidates(election_id);

    const [approvedCandidates, setApprovedCandidates] = useState<WriteInCandidate[]>([]);
    const [validationError, setValidationError] = useState<string | null>(null);

    const race = election.races.find(r => r.race_id === race_id);

    useEffect(() => {
        if (race?.write_in_candidates) {
            setApprovedCandidates(race.write_in_candidates);
        }
    }, [race]);

    useEffect(() => {
        fetchWriteIns();
    }, [election_id]);

    // Get all write-in names from ballots for this specific race
    const allWriteInNames = useMemo(() => {
        if (!writeInData?.write_in_data) return [];
        const raceData = writeInData.write_in_data.find(d => d.race_id === race_id);
        if (!raceData?.names) return [];
        return Object.entries(raceData.names)
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => a.name.localeCompare(b.name));
    }, [writeInData, race_id]);

    // Get unmatched write-in names (not matching any official name or alias)
    const unmatchedWriteIns = useMemo(() => {
        return allWriteInNames.filter(w =>
            !approvedCandidates.some(candidate => matchesWriteInCandidate(w.name, candidate))
        );
    }, [allWriteInNames, approvedCandidates]);

    // Validation: check for duplicate match targets (case-insensitive, trimmed)
    const validateCandidates = (candidates: WriteInCandidate[]): string | null => {
        // Collect all match strings (official names + aliases) from all candidates
        const allMatchStrings: { candidate: WriteInCandidate, str: string }[] = [];

        for (const candidate of candidates) {
            if (candidate.candidate_name) {
                allMatchStrings.push({ candidate, str: candidate.candidate_name });
            }
            candidate.aliases.forEach(alias => {
                allMatchStrings.push({ candidate, str: alias });
            });
        }

        // Check if any two strings would match each other
        for (let i = 0; i < allMatchStrings.length; i++) {
            for (let j = i + 1; j < allMatchStrings.length; j++) {
                if (matchesWriteInCandidate(allMatchStrings[i].str, {
                    candidate_name: allMatchStrings[j].str,
                    aliases: [],
                    approved: true
                })) {
                    return `Duplicate match target (case-insensitive): "${allMatchStrings[i].str}" and "${allMatchStrings[j].str}"`;
                }
            }
        }
        return null;
    };

    const addApprovedCandidate = () => {
        const newCandidate: WriteInCandidate = {
            candidate_name: '',
            aliases: [],
            approved: true
        };
        setApprovedCandidates([...approvedCandidates, newCandidate]);
        setValidationError(null);
    };

    const updateCandidateName = (index: number, name: string) => {
        const updated = [...approvedCandidates];
        updated[index].candidate_name = name;
        setApprovedCandidates(updated);
        setValidationError(validateCandidates(updated));
    };

    const addAlias = (candidateIndex: number, alias: string) => {
        if (!alias.trim()) return;
        const updated = [...approvedCandidates];
        if (!updated[candidateIndex].aliases.includes(alias)) {
            updated[candidateIndex].aliases.push(alias);
            updated[candidateIndex].aliases.sort();
        }
        setApprovedCandidates(updated);
        setValidationError(validateCandidates(updated));
    };

    const removeAlias = (candidateIndex: number, alias: string) => {
        const updated = [...approvedCandidates];
        updated[candidateIndex].aliases = updated[candidateIndex].aliases.filter(a => a !== alias);
        setApprovedCandidates(updated);
        setValidationError(validateCandidates(updated));
    };

    const deleteCandidate = (index: number) => {
        const updated = approvedCandidates.filter((_, i) => i !== index);
        setApprovedCandidates(updated);
        setValidationError(validateCandidates(updated));
    };

    const toggleApproval = (index: number) => {
        const updated = [...approvedCandidates];
        updated[index].approved = !updated[index].approved;
        setApprovedCandidates(updated);
    };

    const handleSave = async () => {
        const error = validateCandidates(approvedCandidates);
        if (error) {
            setValidationError(error);
            return;
        }

        await saveWriteIns({
            write_in_candidates: {
                race_id: race_id!,
                write_in_candidates: approvedCandidates
            }
        });
        await refreshElection();
        navigate(`/${election_id}/admin`);
    };

    if (!race) {
        return <Typography>Race not found</Typography>;
    }

    if (isLoading) {
        return <Typography>Loading write-ins...</Typography>;
    }

    return (
        <Box sx={{ p: 3, maxWidth: 1400, margin: 'auto' }}>
            <Typography variant="h4" gutterBottom>
                Process Write-In Candidates: {race.title}
            </Typography>

            {validationError && (
                <Alert severity="error" sx={{ mb: 2 }}>
                    {validationError}
                </Alert>
            )}

            <Box sx={{ display: 'flex', gap: 3, flexDirection: { xs: 'column', md: 'row' } }}>
                {/* Left Panel: Approved Candidates */}
                <Paper sx={{ flex: 1, p: 2 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                        <Typography variant="h6">Approved Candidates</Typography>
                        <Button
                            startIcon={<AddIcon />}
                            onClick={addApprovedCandidate}
                            variant="contained"
                        >
                            Add Candidate
                        </Button>
                    </Box>

                    <Stack spacing={2}>
                        {approvedCandidates.map((candidate, index) => (
                            <ApprovedCandidateCard
                                key={index}
                                candidate={candidate}
                                index={index}
                                onUpdateName={(name) => updateCandidateName(index, name)}
                                onAddAlias={(alias) => addAlias(index, alias)}
                                onRemoveAlias={(alias) => removeAlias(index, alias)}
                                onDelete={() => deleteCandidate(index)}
                                onToggleApproval={() => toggleApproval(index)}
                            />
                        ))}
                    </Stack>
                </Paper>

                {/* Right Panel: Unmatched Write-Ins */}
                <Paper sx={{ flex: 1, p: 2 }}>
                    <Typography variant="h6" gutterBottom>
                        Unmatched Write-Ins ({unmatchedWriteIns.length})
                    </Typography>
                    <List>
                        {unmatchedWriteIns.map((writeIn, index) => (
                            <ListItem key={index}>
                                <ListItemText
                                    primary={writeIn.name}
                                    secondary={`${writeIn.count} vote${writeIn.count > 1 ? 's' : ''}`}
                                />
                            </ListItem>
                        ))}
                        {unmatchedWriteIns.length === 0 && (
                            <Typography color="text.secondary" sx={{ p: 2 }}>
                                All write-ins have been matched to approved candidates
                            </Typography>
                        )}
                    </List>
                </Paper>
            </Box>

            <Box sx={{ mt: 3, display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
                <Button onClick={() => navigate(`/${election_id}/admin`)}>
                    Cancel
                </Button>
                <PrimaryButton
                    onClick={handleSave}
                    disabled={isSaving || !!validationError}
                >
                    Save Changes
                </PrimaryButton>
            </Box>
        </Box>
    );
}

interface ApprovedCandidateCardProps {
    candidate: WriteInCandidate;
    index: number;
    onUpdateName: (name: string) => void;
    onAddAlias: (alias: string) => void;
    onRemoveAlias: (alias: string) => void;
    onDelete: () => void;
    onToggleApproval: () => void;
}

function ApprovedCandidateCard({
    candidate,
    index,
    onUpdateName,
    onAddAlias,
    onRemoveAlias,
    onDelete,
    onToggleApproval
}: ApprovedCandidateCardProps) {
    const [newAlias, setNewAlias] = useState('');

    const handleAddAlias = () => {
        onAddAlias(newAlias);
        setNewAlias('');
    };

    return (
        <Accordion>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                    <TextField
                        value={candidate.candidate_name}
                        onChange={(e) => onUpdateName(e.target.value)}
                        placeholder="Official candidate name"
                        onClick={(e) => e.stopPropagation()}
                        size="small"
                        sx={{ flex: 1 }}
                    />
                    <Chip
                        label={candidate.approved ? 'Approved' : 'Unapproved'}
                        color={candidate.approved ? 'success' : 'default'}
                        onClick={(e) => {
                            e.stopPropagation();
                            onToggleApproval();
                        }}
                        size="small"
                    />
                    <IconButton
                        size="small"
                        onClick={(e) => {
                            e.stopPropagation();
                            onDelete();
                        }}
                        color="error"
                    >
                        <DeleteIcon />
                    </IconButton>
                </Box>
            </AccordionSummary>
            <AccordionDetails>
                <Typography variant="subtitle2" gutterBottom>
                    Match Targets
                </Typography>
                <Stack spacing={1}>
                    {/* Show official name first (can't be deleted) */}
                    {candidate.candidate_name && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Chip
                                label={candidate.candidate_name}
                                color="primary"
                            />
                            <Typography variant="caption" color="text.secondary">
                                (official name)
                            </Typography>
                        </Box>
                    )}
                    {/* Show explicit aliases */}
                    {candidate.aliases.sort().map((alias, aliasIndex) => (
                        <Box key={aliasIndex} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Chip
                                label={alias}
                                onDelete={() => onRemoveAlias(alias)}
                            />
                        </Box>
                    ))}
                    <Divider />
                    <Box sx={{ display: 'flex', gap: 1 }}>
                        <TextField
                            value={newAlias}
                            onChange={(e) => setNewAlias(e.target.value)}
                            placeholder="Add new alias"
                            size="small"
                            fullWidth
                            onKeyPress={(e) => {
                                if (e.key === 'Enter') {
                                    handleAddAlias();
                                }
                            }}
                        />
                        <Button onClick={handleAddAlias} variant="outlined" size="small">
                            Add
                        </Button>
                    </Box>
                </Stack>
            </AccordionDetails>
        </Accordion>
    );
}
