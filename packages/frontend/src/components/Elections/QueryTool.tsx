import { useEffect, useMemo } from 'react'
import { useGetElections, useQueryElections } from "../../hooks/useAPI";
import { useNavigate } from 'react-router';
import EnhancedTable from '../EnhancedTable';
import {  Container, Link, Typography } from '@mui/material';

export default () => {
    const navigate = useNavigate();

    const { data, isPending, makeRequest: fetchElections } = useQueryElections();

    useEffect(() => {fetchElections()}, []);

    const openElectionsData = useMemo(
        () => {
            console.log(data)
            return data?.open_elections ? [...data.open_elections] : []
        },
        [data]
    );

    const voteCounts = useMemo(
        () => data?.vote_counts ? Object.fromEntries(data.vote_counts.map(e => [e.election_id, e.v])) : {},
        [data]
    );

    return <Container>
        <EnhancedTable
            title='Open elections created within the time range'
            headKeys={[ 'title', 'create_date', 'votes', 'election_state', 'owner_id']}
            data={openElectionsData}
            voteCounts={voteCounts}
            isPending={isPending}
            pendingMessage='Loading Elections...'
            handleOnClick={(election) => navigate(`/${String(election.raw.election_id)}`)}
            defaultSortBy='create_date'
            emptyContent='No elections'
        />
    </Container>
}