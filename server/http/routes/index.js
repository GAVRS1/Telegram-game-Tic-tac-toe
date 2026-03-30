import { registerConfigRoute } from "./config.js";
import { registerDailyRoute } from "./daily.js";
import { registerInviteRoute } from "./invite.js";
import { registerLeadersRoute } from "./leaders.js";
import { registerProfileRoute } from "./profile.js";

export const registerHttpRoutes = ({ app, port, publicUrl, inviteService }) => {
  registerConfigRoute({ app, port, publicUrl });
  registerLeadersRoute({ app });
  registerProfileRoute({ app });
  registerDailyRoute({ app });
  registerInviteRoute({ app, inviteService });
};
