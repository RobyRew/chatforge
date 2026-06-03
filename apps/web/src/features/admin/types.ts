import type { Me } from '../../lib/api';

/** Props every admin section receives (the current user, for granular UI gating). */
export interface AdminSectionProps {
  me: Me;
}
