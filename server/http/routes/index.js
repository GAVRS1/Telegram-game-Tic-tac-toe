import { registerConfigRoute } from "./config.js";
import { registerInviteRoute } from "./invite.js";
import { registerLeadersRoute } from "./leaders.js";
import { registerProfileRoute } from "./profile.js";

export const registerHttpRoutes = ({ app, port, publicUrl, inviteService }) => {
  registerConfigRoute({ app, port, publicUrl });
  registerLeadersRoute({ app });
  registerProfileRoute({ app });
  registerInviteRoute({ app, inviteService });
};
