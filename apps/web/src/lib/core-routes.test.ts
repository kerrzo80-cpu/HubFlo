import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  homeViewForPath,
  isCoreModulePath,
  modulePathForHomeView,
  normalizeCorePath,
  resolveHomeViewFromPathname,
} from "@/lib/core-routes";

describe("core-routes", () => {
  it("maps nested home views to parent module paths", () => {
    assert.equal(modulePathForHomeView("dashboard"), "/");
    assert.equal(modulePathForHomeView("job-record"), "/jobs");
    assert.equal(modulePathForHomeView("cost-centre-record"), "/jobs");
    assert.equal(modulePathForHomeView("quote-cost-centre-record"), "/quotes");
    assert.equal(modulePathForHomeView("lead-create"), "/leads");
    assert.equal(modulePathForHomeView("settings"), "/setup");
    assert.equal(modulePathForHomeView("addons"), "/setup");
    assert.equal(modulePathForHomeView("clients"), "/people");
    assert.equal(modulePathForHomeView("directory-manager"), "/people");
    assert.equal(modulePathForHomeView("invoice-record"), "/invoices");
  });

  it("resolves module paths to directory home views", () => {
    assert.equal(homeViewForPath("/"), "dashboard");
    assert.equal(homeViewForPath("/jobs"), "jobs");
    assert.equal(homeViewForPath("/setup"), "settings");
    assert.equal(homeViewForPath("/people"), "employees");
    assert.equal(homeViewForPath("/field"), null);
    assert.equal(homeViewForPath("/nexa"), null);
  });

  it("normalizes and recognizes core module paths", () => {
    assert.equal(normalizeCorePath("/quotes?x=1"), "/quotes");
    assert.equal(isCoreModulePath("/reports"), true);
    assert.equal(isCoreModulePath("/takeoff"), false);
  });

  it("does not reset homeView to dashboard while a tab navigation is in flight", () => {
    const midClick = resolveHomeViewFromPathname({
      pathname: "/",
      homeView: "jobs",
      pendingPath: "/jobs",
    });
    assert.equal(midClick.homeView, null);
    assert.equal(midClick.pendingPath, "/jobs");

    const landed = resolveHomeViewFromPathname({
      pathname: "/jobs",
      homeView: "jobs",
      pendingPath: "/jobs",
    });
    assert.equal(landed.homeView, null);
    assert.equal(landed.pendingPath, null);
  });

  it("preserves nested record views when pathname already matches the module", () => {
    const nested = resolveHomeViewFromPathname({
      pathname: "/jobs",
      homeView: "job-record",
      pendingPath: null,
    });
    assert.equal(nested.homeView, null);

    const back = resolveHomeViewFromPathname({
      pathname: "/",
      homeView: "jobs",
      pendingPath: null,
    });
    assert.equal(back.homeView, "dashboard");
  });
});
