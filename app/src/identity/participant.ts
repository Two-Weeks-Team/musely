// Public profile only. Account subjects, ownership, root/key references and auth versions stay worker-private.
import type {AppearanceId} from '../character-kit/appearance.ts';

/** actorId identifies the participant; appearanceId selects reusable existing assets, never authority. */
export type ActorProfile = {
  actorId: string;
  displayName: string;
  appearanceId: AppearanceId;
  revision: number;
};
