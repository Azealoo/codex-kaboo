import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// `/cli/(.*)` is kept here even though the matcher below never routes it to this middleware: if
// someone ever widens the matcher, the installer stays public rather than silently starting to
// demand a session.
const isPublicRoute = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)", "/cli/(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals, everything under /cli/, and common static files.
    //
    // /cli/ is excluded here, not just marked public below, and the difference matters: a public
    // route still RUNS this middleware, so serving the installer would depend on Clerk being
    // configured and reachable. `npm install -g https://<app>/cli/codex-kaboo-cli.tgz` is the
    // first thing a new user does — before they have an account at all — so a Clerk outage or a
    // bad key must not be able to break it. Skipping the matcher serves the tarball and
    // version.json straight from `public/`, with no auth code in the path.
    //
    // Neither `.tgz` nor `.json` is in the extension list (note `js(?!on)`), so without the
    // explicit `cli/` rule both would fall through to the proxy.
    "/((?!_next|cli/|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/(.*)",
  ],
};
