import { COUNTRY, LANGUAGE, LOCALE, SESSION_ID, VISITOR_ID, ZONE, clean, publicGql } from "./seek.js";

export type SuggestKind =
  | "keywords" | "search_locations" | "profile_locations" | "role_titles" | "companies" | "schools"
  | "qualifications" | "skills" | "licences" | "languages" | "rights_to_work";

export async function suggest(kind: SuggestKind, query: string, count = 10) {
  const q = query.trim();
  if (!q) throw new Error("Give some text to complete");
  const ontologyVars = { query: q, countryCode: COUNTRY, languageCode: LANGUAGE, session: SESSION_ID };
  const specReq = async (profileField: string) =>
    ((await publicGql("getSpecReqs", { query: q, session: SESSION_ID, profileField, countryCode: COUNTRY, languageCode: LANGUAGE }))
      ?.ontologySpecReqs ?? []).map((s: any) => clean({ text: s.normalisedText, ontologyId: s.id, asksForExpiry: s.collectExpiry || undefined }));
  const ontology = (rows: any[]) => (rows ?? []).map((r: any) => clean({ text: r.normalisedText, ontologyId: r.id }));

  switch (kind) {
    case "keywords": {
      const d = await publicGql("getKeywordSuggestions", { keyword: q, country: COUNTRY, visitorId: VISITOR_ID, count });
      return (d?.searchKeywordsSuggest?.suggestions ?? []).map((s: any) => s.text).filter(Boolean);
    }
    case "search_locations": {
      const d = await publicGql("searchLocationsSuggest", {
        query: q, count, recentLocation: "", locale: LOCALE, country: COUNTRY, visitorId: VISITOR_ID, isRemoteEnabled: true,
      });
      return (d?.searchLocationsSuggest?.suggestions ?? []).flatMap((s: any) =>
        s.suggestions ? s.suggestions.map((x: any) => x.text) : [s.text],
      );
    }
    case "profile_locations": {
      const d = await publicGql("getProfileLocationSuggest", {
        query: q, session: SESSION_ID, zone: ZONE, locationType: "Home", languageCode: LANGUAGE,
      });
      return (d?.profileLocationSuggest ?? []).flatMap((s: any) => (s.suggestions ?? [s])).map((l: any) =>
        clean({ id: Number(l.id), name: l.contextualName, short: l.shortName, kind: l.kind, country: l.countryCode }),
      );
    }
    case "role_titles":
      return ontology((await publicGql("getRoleTitle", ontologyVars))?.ontologyRoleTitlesSeniority);
    case "companies":
      return ontology((await publicGql("getOrganisations", ontologyVars))?.ontologyOrganisations);
    case "schools":
      return ontology((await publicGql("getEducationProviders", ontologyVars))?.ontologyEducationProviders);
    case "qualifications":
      return ontology((await publicGql("getQualifications", ontologyVars))?.ontologyQualifications);
    case "skills":
      return specReq("Skills");
    case "licences":
      return specReq("LicencesCertifications");
    case "languages":
      return specReq("LanguageProficiency");
    case "rights_to_work": {
      const d = await publicGql("getRightToWorkOptions", { query: q, languageCode: LANGUAGE, zone: ZONE, source: "PROFILE" });
      return (d?.rightToWorkOptions ?? []).flatMap((c: any) =>
        (c.options ?? []).map((o: any) => ({ id: o.id, description: o.description, country: c.country?.countryCode })),
      );
    }
  }
}

export async function classifications() {
  const d = await publicGql("getClassificationOptions", { zone: ZONE, languageCode: LANGUAGE });
  return (d?.preferredClassificationOptions ?? []).map((c: any) => ({
    id: c.id,
    name: c.description,
    subclassifications: (c.subClassifications ?? []).map((s: any) => ({ id: s.id, name: s.description })),
  }));
}

export async function profileOptions() {
  const [availability, workTypes, visibility] = await Promise.all([
    publicGql("GetAvailabilityOptions", { languageCode: LANGUAGE }),
    publicGql("GetWorkTypeOptions", { languageCode: LANGUAGE }),
    publicGql("GetProfileVisibilityOptions", { locale: LOCALE, zone: ZONE }),
  ]);
  return {
    availability: availability?.availabilityOptions ?? [],
    workTypes: workTypes?.workTypeOptions ?? [],
    visibility: (visibility?.profileVisibilityOptions ?? []).map((v: any) => ({ id: v.id, label: v.label, description: v.description })),
  };
}
