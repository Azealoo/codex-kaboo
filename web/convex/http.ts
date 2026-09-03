import { httpRouter } from "convex/server";
import { HEALTH_PATH, SYNC_PATH, WHOAMI_PATH } from "../../shared/src/constants";
import { healthHandler, syncHandler, whoamiHandler } from "./ingest";

const http = httpRouter();

http.route({ path: SYNC_PATH, method: "POST", handler: syncHandler });
http.route({ path: WHOAMI_PATH, method: "GET", handler: whoamiHandler });
http.route({ path: HEALTH_PATH, method: "GET", handler: healthHandler });

export default http;
