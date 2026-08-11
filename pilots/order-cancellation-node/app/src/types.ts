export const cancellationReasonOptions = [
  { code: "ORDERED_BY_MISTAKE", label: "Ordered by mistake", detailRequired: false },
  { code: "DUPLICATE_ORDER", label: "Duplicate order", detailRequired: false },
  { code: "DELIVERY_TOO_LATE", label: "Delivery timing no longer works", detailRequired: false },
  { code: "OTHER", label: "Other reason", detailRequired: true },
] as const;

export type CancellationReasonCode = (typeof cancellationReasonOptions)[number]["code"];
export type PaymentStatus = "PAID" | "REFUND_PENDING" | "REFUNDED";
export type ShipmentStatus = "NOT_STARTED" | "PROCESSING" | "SHIPPED";
export type CancellationStatus = "PENDING" | "COMPLETED" | "FAILED";

export interface Money {
  currency: string;
  amountMinor: number;
}

export interface OrderRecord {
  id: string;
  customerId: string;
  version: number;
  paymentStatus: PaymentStatus;
  shipmentStatus: ShipmentStatus;
  paidAmount: Money;
  cancellationId?: string;
}

export interface CancellationRecord {
  id: string;
  orderId: string;
  customerId: string;
  reasonCode: CancellationReasonCode;
  reasonDetail?: string;
  status: CancellationStatus;
  acceptedAt: string;
  updatedAt: string;
  traceId: string;
  outcomeCode?: string;
  refund?: Money;
}

export interface CancellationRequest {
  reasonCode: CancellationReasonCode;
  reasonDetail?: string;
  expectedVersion: number;
}

export interface CancellationContext {
  orderId: string;
  orderVersion: number;
  paymentStatus: PaymentStatus;
  shipmentStatus: ShipmentStatus;
  capability: {
    allowed: boolean;
    unavailableReasonCode?: string;
  };
  reasonOptions: Array<{
    code: CancellationReasonCode;
    label: string;
    detailRequired: boolean;
  }>;
  estimatedRefund: Money;
}

export interface CancellationReceipt {
  cancellationId: string;
  orderId: string;
  status: CancellationStatus;
  acceptedAt: string;
  updatedAt: string;
  outcomeCode?: string;
  refund?: Money;
  traceId: string;
}

export interface FieldError {
  field: string;
  code: string;
  message?: string;
}

export interface ErrorBody {
  code: string;
  message: string;
  retryable: boolean;
  traceId: string;
  fieldErrors?: FieldError[];
  details?: Record<string, unknown>;
}
