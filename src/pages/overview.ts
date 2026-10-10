import { ButtonVariant } from "@antelopejs/interface-dms/base/types/button";
import { ActivityFeed } from "@antelopejs/interface-dms/base/activity-feed";
import { Banner } from "@antelopejs/interface-dms/base/banner";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { Grid, GridRow } from "@antelopejs/interface-dms/base/grid";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { NavCardGrid } from "@antelopejs/interface-dms/base/nav-card-grid";
import { Section } from "@antelopejs/interface-dms/base/section";
import { TopListCard } from "@antelopejs/interface-dms/base/top-list-card";
import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { DATABASE_MODULE_ID, DATABASE_PATHS, exploreSection } from "../module";
import { OVERVIEW_FEED_LIMIT } from "../types/constants";

// Bumped whenever the notice says something new, so a reader who dismissed
// the previous one sees it again.
const BETA_NOTICE_KEY = "dms-database-beta-v2";

@RegisterPage()
export class DatabaseOverviewPage extends PageController(
  "overview",
  {
    displayName: "$dms_database.overview.title",
    description: "$dms_database.overview.description",
    icon: "i-ph-gauge",
    module: DATABASE_MODULE_ID,
    category: exploreSection,
    order: 0,
  },
  DefaultLayout({
    headerActions: [
      {
        id: "open-query",
        label: "$dms_database.overview.actions.query",
        icon: "i-ph-code",
        variant: ButtonVariant.outline,
        color: "neutral",
        target: { type: "page", url: DATABASE_PATHS.query },
      },
      {
        id: "browse-data",
        label: "$dms_database.overview.actions.browse",
        icon: "i-ph-rows",
        variant: ButtonVariant.solid,
        color: "primary",
        target: { type: "page", url: DATABASE_PATHS.data },
      },
    ],
  }),
) {
  static beta = Banner({
    tone: "warning",
    size: "sm",
    title: "$dms_database.overview.beta.title",
    description: "$dms_database.overview.beta.body",
    dismissible: true,
    dismissKey: BETA_NOTICE_KEY,
  }).meta({
    name: "$dms_database.overview.beta.meta",
    icon: "i-ph-flask",
    description: "$dms_database.overview.beta.meta_description",
  });

  static connection = CustomComponent("DmsDatabaseConnectionStatus").meta({
    name: "$dms_database.overview.connection.meta",
    icon: "i-ph-heartbeat",
    description: "$dms_database.overview.connection.meta_description",
  });

  static schemas = Section({
    title: "$dms_database.overview.schemas.title",
    description: "$dms_database.overview.schemas.description",
    card: false,
  })
    .child(
      "cards",
      NavCardGrid({
        fetchUrl: "/api/database/overview/schemas",
        columns: 3,
        skeletonCount: 3,
        empty: {
          title: "$dms_database.overview.schemas.empty_title",
          description: "$dms_database.overview.schemas.empty_description",
        },
      }).meta({
        name: "$dms_database.overview.schemas.cards_meta",
        icon: "i-ph-stack",
      }),
    )
    .meta({
      name: "$dms_database.overview.schemas.title",
      icon: "i-ph-stack",
    });

  static activity = Grid()
    .child(
      "row",
      GridRow()
        .child(
          "largest",
          TopListCard({
            title: "$dms_database.overview.largest.title",
            description: "$dms_database.overview.largest.description",
            fetchUrl: "/api/database/overview/largest",
            valueFormat: "compact",
            showBar: true,
            showRank: false,
            showDelta: false,
            skeletonCount: OVERVIEW_FEED_LIMIT,
            emptyLabel: "$dms_database.overview.largest.empty",
          }).meta({
            name: "$dms_database.overview.largest.title",
            icon: "i-ph-chart-bar-horizontal",
          }),
        )
        .child(
          "recent",
          ActivityFeed({
            title: "$dms_database.overview.recent.title",
            fetchUrl: "/api/database/overview/recent-queries",
            mono: true,
            groupByDay: false,
            maxItems: OVERVIEW_FEED_LIMIT,
            skeletonCount: OVERVIEW_FEED_LIMIT,
            card: true,
            actions: [
              {
                label: "$dms_database.overview.recent.console",
                to: DATABASE_PATHS.query,
                icon: "i-ph-arrow-right",
              },
            ],
            empty: {
              title: "$dms_database.overview.recent.empty_title",
              description: "$dms_database.overview.recent.empty_description",
            },
          }).meta({
            name: "$dms_database.overview.recent.title",
            icon: "i-ph-clock-counter-clockwise",
          }),
        ),
    )
    .meta({
      name: "$dms_database.overview.activity_meta",
      icon: "i-ph-squares-four",
    });
}
