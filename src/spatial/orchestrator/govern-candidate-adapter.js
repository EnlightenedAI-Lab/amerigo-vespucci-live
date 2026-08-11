/**
 * GovernCandidate adapter — delegates admission authority to Agent 2.
 */
export { governCandidateViaAgent2 as governCandidate } from './govern-candidate-client.js';
export {
  mapEventToAgent2Candidate,
  validateGovernCandidateResponse,
  GOVERN_CANDIDATE_PATH
} from './govern-candidate-client.js';
