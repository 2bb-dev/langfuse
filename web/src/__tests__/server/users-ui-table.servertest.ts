import {
  createObservation as createObservationObject,
  createTrace,
} from "@langfuse/shared/src/server";
import {
  createObservationsCh as createObservationsInClickhouse,
  createTracesCh,
} from "@langfuse/shared/src/server";
import { v4 as uuidv4 } from "uuid";
import { getUserMetrics } from "@langfuse/shared/src/server";

const projectId = "7a88fb47-b4e2-43b8-a06c-a5ce950dc53a";

describe("getUserMetrics function", () => {
  it("should return correct user metrics for a trace with two observations", async () => {
    const userId = uuidv4();
    const traceId = uuidv4();

    const trace = createTrace({
      id: traceId,
      project_id: projectId,
      user_id: userId,
    });

    await createTracesCh([trace]);

    const observation1 = createObservationObject({
      id: uuidv4(),
      trace_id: traceId,
      project_id: projectId,
      usage_details: {
        input: 100,
        output: 200,
        total: 300,
      },
      total_cost: 50,
      type: "GENERATION",
    });

    const observation2 = createObservationObject({
      id: uuidv4(),
      trace_id: traceId,
      project_id: projectId,
      usage_details: {
        input: 150,
        output: 250,
        total: 400,
      },
      total_cost: 75,
      type: "GENERATION",
    });

    await createObservationsInClickhouse([observation1, observation2]);

    const userMetrics = await getUserMetrics(projectId, [userId], []);

    expect(userMetrics.length).toBe(1);
    expect(userMetrics[0]).toMatchObject({
      userId: userId,
      inputUsage: 250, // 100 + 150
      outputUsage: 450, // 200 + 250
      totalUsage: 700, // 300 + 400
      observationCount: 2,
      traceCount: 1,
      totalCost: 125, // 50 + 75
    });
  });

  it("should return correct user metrics for a trace with two observations and timestamp filter", async () => {
    const userId = uuidv4();
    const traceId = uuidv4();

    const trace = createTrace({
      id: traceId,
      project_id: projectId,
      user_id: userId,
    });

    await createTracesCh([trace]);

    const observation1 = createObservationObject({
      id: uuidv4(),
      trace_id: traceId,
      project_id: projectId,
      usage_details: {
        input: 100,
        output: 200,
        total: 300,
      },
      total_cost: 50,
      type: "GENERATION",
    });

    const observation2 = createObservationObject({
      id: uuidv4(),
      trace_id: traceId,
      project_id: projectId,
      usage_details: {
        input: 150,
        output: 250,
        total: 400,
      },
      total_cost: 75,
      type: "GENERATION",
    });

    await createObservationsInClickhouse([observation1, observation2]);

    const userMetrics = await getUserMetrics(
      projectId,
      [userId],
      [
        {
          column: "timestamp",
          type: "datetime",
          operator: ">=",
          value: new Date(new Date().getTime() - 1000),
        },
      ],
    );

    expect(userMetrics.length).toBe(1);
    expect(userMetrics[0]).toMatchObject({
      userId: userId,
      inputUsage: 250, // 100 + 150
      outputUsage: 450, // 200 + 250
      totalUsage: 700, // 300 + 400
      observationCount: 2,
      traceCount: 1,
      totalCost: 125, // 50 + 75
    });
  });

  it("surfaces openclaw_channel and coalesced openclaw sender identity", async () => {
    const userId = uuidv4();
    const traceA = uuidv4();
    const traceB = uuidv4();

    await createTracesCh([
      createTrace({
        id: traceA,
        project_id: projectId,
        user_id: userId,
        metadata: {
          openclaw_channel: "mattermost",
          // username absent on this trace - falls back to name.
          openclaw_sender_name: "@ziabinartem",
          openclaw_sender_label: "@ziabinartem (pwanex3ne3fx58nr5oaxg4j54w)",
        },
      }),
      createTrace({
        id: traceB,
        project_id: projectId,
        user_id: userId,
        metadata: {
          openclaw_channel: "mattermost",
          openclaw_sender_username: "ziabinartem",
        },
      }),
    ]);

    // One observation per trace is required for the inner join to return rows.
    await createObservationsInClickhouse([
      createObservationObject({
        id: uuidv4(),
        trace_id: traceA,
        project_id: projectId,
        type: "GENERATION",
      }),
      createObservationObject({
        id: uuidv4(),
        trace_id: traceB,
        project_id: projectId,
        type: "GENERATION",
      }),
    ]);

    const result = await getUserMetrics(projectId, [userId], []);
    expect(result).toHaveLength(1);
    expect(result[0].openclawChannel).toBe("mattermost");
    // username resolves via coalesce priority - one trace has username, the
    // other falls back to name. Either non-empty value is acceptable since
    // anyIf does not guarantee ordering.
    expect(
      ["ziabinartem", "@ziabinartem"].includes(
        result[0].openclawUsername ?? "",
      ),
    ).toBe(true);
  });

  it("returns null openclaw fields when trace metadata is missing", async () => {
    const userId = uuidv4();
    const traceId = uuidv4();

    await createTracesCh([
      createTrace({
        id: traceId,
        project_id: projectId,
        user_id: userId,
        metadata: {
          source: "API",
        },
      }),
    ]);

    await createObservationsInClickhouse([
      createObservationObject({
        id: uuidv4(),
        trace_id: traceId,
        project_id: projectId,
        type: "GENERATION",
      }),
    ]);

    const result = await getUserMetrics(projectId, [userId], []);
    expect(result).toHaveLength(1);
    expect(result[0].openclawChannel).toBeNull();
    expect(result[0].openclawUsername).toBeNull();
  });
});
