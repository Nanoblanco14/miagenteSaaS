"use client";

import { useEffect } from "react";

/** Older invitation emails return to the site root with an Auth fragment. */
export default function AuthLinkRedirect() {
    useEffect(() => {
        if (window.location.pathname === "/auth/password") return;
        const hash = new URLSearchParams(window.location.hash.slice(1));
        const type = hash.get("type");
        if (type === "invite" || type === "recovery" || hash.has("error_code")) {
            // Preserve the one-time credentials only in the fragment, never in a query.
            window.location.replace(`/auth/password${window.location.hash}`);
        }
    }, []);

    return null;
}
