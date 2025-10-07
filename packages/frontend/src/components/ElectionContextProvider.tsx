import { ReactNode, useContext, useEffect } from 'react'
import { createContext } from 'react'
import { Election } from '@equal-vote/star-vote-shared/domain_model/Election';
import { useEditElection, useGetElection, useGetResults } from '../hooks/useAPI';
import { Election as IElection } from '@equal-vote/star-vote-shared/domain_model/Election';
import { VoterAuth } from '@equal-vote/star-vote-shared/domain_model/VoterAuth';
import { ElectionResults } from '@equal-vote/star-vote-shared/domain_model/ITabulators';
import structuredClone from '@ungap/structured-clone';
import { useSubstitutedTranslation } from './util';


export interface IElectionContext {
    election: Election;
    precinctFilteredElection: Election;
    voterAuth: VoterAuth;
    results: ElectionResults[] | null;
    refreshElection: (data?: undefined) => Promise<false | {
        election: Election;
        precinctFilteredElection: Election;
        voterAuth: VoterAuth;
    }>;
    updateElection: (updateFunc: (election: IElection) => void) => Promise<false | {
        election: Election;
    }>;
    fetchResultsIfNeeded: () => Promise<void>;
    permissions: string[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    t: (key?: string, v?: object) => any;
}


export const ElectionContext = createContext<IElectionContext>({
    election: null,
    precinctFilteredElection: null,
    voterAuth: null,
    results: null,
    refreshElection: () => Promise.resolve(false),
    updateElection: () => Promise.resolve(false),
    fetchResultsIfNeeded: () => Promise.resolve(),
    permissions: [],
    t: () => undefined
})

export const ElectionContextProvider = ({ id, children }: { id: string, children: ReactNode}) => {
    const { data, makeRequest: fetchData } = useGetElection(id)
    const { data: resultsData, makeRequest: fetchResults } = useGetResults(id)
    const { makeRequest: editElection } = useEditElection(id)

    useEffect(() => {
        if(id != undefined) {
            fetchData()
        }
    }, [id])

    const applyElectionUpdate = async (updateFunc: (election: IElection) => void) => {
        if (!data.election) return
        const electionCopy: IElection = structuredClone(data.election)
        updateFunc(electionCopy)
        return await editElection({ Election: electionCopy })
    };

    const refresh = async () => {
        await fetchData();
        return data;
    };

    const fetchResultsIfNeeded = async () => {
        if (!resultsData) {
            await fetchResults();
        }
    };

    // This should use local timezone by default, consumers will have to call it directly if they want it to use the election timezone
    const {t} = useSubstitutedTranslation(data?.election?.settings?.term_type ?? 'election');

    return (<ElectionContext.Provider
        value={{
            election: data?.election,
            precinctFilteredElection: data?.precinctFilteredElection,
            voterAuth: data?.voterAuth,
            results: resultsData?.results || null,
            refreshElection: refresh,
            updateElection: applyElectionUpdate,
            fetchResultsIfNeeded,
            permissions: data?.voterAuth?.permissions,
            t,
        }}>
        {(data || id == undefined) && children}
    </ElectionContext.Provider>
    )
}

export default function useElection() {
    return useContext(ElectionContext);
}
