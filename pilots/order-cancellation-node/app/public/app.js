const pilot = {
  actorToken: "customer-1",
  orderId: "order-1001",
  context: null,
  idempotencyKey: null,
};

const elements = {
  workspace: document.querySelector("#workspace"),
  form: document.querySelector("#cancel-form"),
  reasonCode: document.querySelector("#reason-code"),
  reasonDetail: document.querySelector("#reason-detail"),
  detailGroup: document.querySelector("#detail-group"),
  submit: document.querySelector("#submit-cancellation"),
  capability: document.querySelector("#capability-status"),
  eligibility: document.querySelector("#eligibility-copy"),
  payment: document.querySelector("#payment-status"),
  shipment: document.querySelector("#shipment-status"),
  refund: document.querySelector("#refund-amount"),
  version: document.querySelector("#order-version"),
  result: document.querySelector("#operation-result"),
  resultTitle: document.querySelector("#result-title"),
  resultMessage: document.querySelector("#result-message"),
  reference: document.querySelector("#operation-reference"),
  refresh: document.querySelector("#refresh-context"),
};

function requestHeaders(extra = {}) {
  return {
    Authorization: `Bearer ${pilot.actorToken}`,
    "X-Request-Id": crypto.randomUUID(),
    ...extra,
  };
}

function formatMoney(money) {
  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: money.currency,
  });
  const minorDigits = formatter.resolvedOptions().maximumFractionDigits;
  return formatter.format(money.amountMinor / 10 ** minorDigits);
}

function setWorkspaceState(state) {
  elements.workspace.dataset.state = state;
  elements.workspace.setAttribute("aria-busy", String(state === "loading" || state === "submitting"));
}

function setResult(title, message, reference) {
  elements.resultTitle.textContent = title;
  elements.resultMessage.textContent = message;
  if (reference) {
    elements.reference.hidden = false;
    elements.reference.textContent = `Operation: ${reference}`;
  } else {
    elements.reference.hidden = true;
    elements.reference.textContent = "";
  }
  elements.result.focus({ preventScroll: true });
}

function applyContext(context) {
  pilot.context = context;
  elements.payment.textContent = context.paymentStatus;
  elements.shipment.textContent = context.shipmentStatus;
  elements.refund.textContent = formatMoney(context.estimatedRefund);
  elements.version.textContent = String(context.orderVersion);

  elements.reasonCode.replaceChildren(new Option("Choose a reason", ""));
  for (const option of context.reasonOptions) {
    elements.reasonCode.add(new Option(option.label, option.code));
  }

  const allowed = context.capability.allowed;
  elements.reasonCode.disabled = !allowed;
  elements.submit.disabled = !allowed;
  elements.capability.textContent = allowed ? "Eligible" : "Unavailable";
  elements.capability.dataset.tone = allowed ? "success" : "warning";
  elements.eligibility.textContent = allowed
    ? "The order is currently paid, unshipped, and eligible. Eligibility is checked again on submit."
    : `Cancellation is unavailable: ${context.capability.unavailableReasonCode ?? "current order state"}.`;
  setWorkspaceState(allowed ? "ready" : "forbidden");
}

function operationStorageKey() {
  return `stackforge-atlas:cancellation:${pilot.orderId}`;
}

function readSavedOperation() {
  try {
    const raw = localStorage.getItem(operationStorageKey());
    if (!raw) {
      return null;
    }
    const value = JSON.parse(raw);
    if (
      typeof value?.location !== "string" ||
      typeof value?.cancellationId !== "string" ||
      !value.location.startsWith("/order-cancellations/")
    ) {
      localStorage.removeItem(operationStorageKey());
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

function saveOperation(location, cancellationId) {
  try {
    localStorage.setItem(
      operationStorageKey(),
      JSON.stringify({ location, cancellationId }),
    );
  } catch {
    // The current session can still follow the resource when storage is unavailable.
  }
}

function clearSavedOperation() {
  try {
    localStorage.removeItem(operationStorageKey());
  } catch {
    // Storage availability is not required for the current request to finish.
  }
}

async function loadContext({ announce = false, followOperation = true } = {}) {
  setWorkspaceState("loading");
  elements.submit.disabled = true;
  elements.capability.textContent = "Loading";
  elements.capability.dataset.tone = "";

  try {
    const response = await fetch(`/orders/${pilot.orderId}/cancellation-context`, {
      headers: requestHeaders(),
    });
    const body = await response.json();
    if (!response.ok) {
      throw body;
    }
    applyContext(body);
    if (followOperation) {
      const restored = readSavedOperation();
      if (restored) {
        setWorkspaceState("pending");
        setResult(
          "Restoring cancellation outcome",
          "Following the durable operation saved by this browser.",
          restored.cancellationId,
        );
        await pollCancellation(restored.location, restored.cancellationId);
        return;
      }
    }
    if (announce) {
      setResult("Order context refreshed", "The latest eligibility and version are now loaded.");
    }
  } catch (error) {
    if (error?.code === "RESOURCE_NOT_FOUND" && readSavedOperation()) {
      clearSavedOperation();
    }
    setWorkspaceState("system_error");
    elements.capability.textContent = "Unavailable";
    elements.capability.dataset.tone = "danger";
    elements.eligibility.textContent = "The order context could not be loaded safely.";
    setResult("Context unavailable", error.message ?? "Try refreshing the order context.");
  }
}

function selectedReasonRequiresDetail() {
  return pilot.context?.reasonOptions.find((option) => option.code === elements.reasonCode.value)
    ?.detailRequired;
}

async function pollCancellation(location, cancellationId) {
  const maxAttempts = 12;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 350));
    const response = await fetch(location, { headers: requestHeaders() });
    const body = await response.json();
    if (!response.ok) {
      throw body;
    }

    if (body.status === "COMPLETED") {
      clearSavedOperation();
      setWorkspaceState("success");
      setResult(
        "Cancellation completed",
        `The provider completed the cancellation. Refund: ${formatMoney(body.refund)}.`,
        body.cancellationId,
      );
      await loadContext({ followOperation: false });
      setWorkspaceState("success");
      return;
    }

    if (body.status === "FAILED") {
      clearSavedOperation();
      setWorkspaceState("terminal_error");
      setResult(
        "Cancellation failed",
        `The operation reached a terminal failure: ${body.outcomeCode ?? "UNKNOWN"}.`,
        body.cancellationId,
      );
      await loadContext({ followOperation: false });
      setWorkspaceState("terminal_error");
      return;
    }
  }

  setWorkspaceState("pending");
  setResult(
    "Cancellation still pending",
    "The durable operation remains available. Refreshing this browser keeps its reference.",
    cancellationId,
  );
}

async function submitCancellation(event) {
  event.preventDefault();
  if (!pilot.context?.capability.allowed) {
    return;
  }

  const reasonCode = elements.reasonCode.value;
  const reasonDetail = elements.reasonDetail.value.trim();
  if (!reasonCode || (selectedReasonRequiresDetail() && !reasonDetail)) {
    setWorkspaceState("validation_error");
    setResult(
      "Check the cancellation reason",
      "Choose a reason and provide detail when the selected reason requires it.",
    );
    elements.reasonCode.focus();
    return;
  }

  const payload = {
    reasonCode,
    reasonDetail: reasonDetail || undefined,
    expectedVersion: pilot.context.orderVersion,
  };
  pilot.idempotencyKey = pilot.idempotencyKey ?? crypto.randomUUID();

  setWorkspaceState("submitting");
  elements.submit.disabled = true;
  setResult("Submitting cancellation", "Waiting for a durable acceptance receipt…");

  try {
    const response = await fetch(`/orders/${pilot.orderId}/cancellations`, {
      method: "POST",
      headers: requestHeaders({
        "Content-Type": "application/json",
        "Idempotency-Key": pilot.idempotencyKey,
      }),
      body: JSON.stringify(payload),
    });
    const body = await response.json();

    if (!response.ok) {
      if (response.status === 409) {
        pilot.idempotencyKey = null;
        const existingId = body.details?.cancellationId;
        if (typeof existingId === "string") {
          const existingLocation = `/order-cancellations/${existingId}`;
          saveOperation(existingLocation, existingId);
          setWorkspaceState("pending");
          setResult(
            "Existing cancellation found",
            "Following the operation that already protected this order.",
            existingId,
          );
          await pollCancellation(existingLocation, existingId);
          return;
        }
        setWorkspaceState("conflict");
        setResult("Order state changed", body.message);
        await loadContext({ followOperation: false });
        setWorkspaceState("conflict");
        return;
      }
      throw body;
    }

    const location = response.headers.get("Location");
    if (!location) {
      throw new Error("Accepted response did not provide a durable operation URL.");
    }

    saveOperation(location, body.cancellationId);
    setWorkspaceState("pending");
    setResult(
      "Cancellation accepted",
      "The provider result is pending. This screen is following the durable operation.",
      body.cancellationId,
    );
    await pollCancellation(location, body.cancellationId);
    pilot.idempotencyKey = null;
    elements.form.reset();
    elements.detailGroup.hidden = true;
  } catch (error) {
    setWorkspaceState("system_error");
    elements.submit.disabled = false;
    setResult(
      "Cancellation could not be confirmed",
      error.message ?? "Retrying this request will reuse the same idempotency key.",
    );
  }
}

elements.reasonCode.addEventListener("change", () => {
  elements.detailGroup.hidden = !selectedReasonRequiresDetail();
  if (elements.detailGroup.hidden) {
    elements.reasonDetail.value = "";
  }
});
elements.form.addEventListener("submit", submitCancellation);
elements.refresh.addEventListener("click", () => void loadContext({ announce: true }));

void loadContext();
