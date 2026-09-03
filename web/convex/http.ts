import { httpRouter } from "convex/server";
import { HEALTH_PATH, SUMMARY_PATH, SYNC_PATH, WHOAMI_PATH } from "../../shared/src/constants";
import { healthHandler, syncHandler, whoamiHandler } from "./ingest";
import { summaryHandler } from "./summary";

const http = httpRouter();

http.route({ path: SYNC_PATH, method: "POST", handler: syncHandler });
http.route({ path: WHOAMI_PATH, method: "GET", handler: whoamiHandler });
http.route({ path: SUMMARY_PATH, method: "GET", handler: summaryHandler });
http.route({ path: HEALTH_PATH, method: "GET", handler: healthHandler });

export default http;
