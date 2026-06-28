import { useForm } from "react-hook-form";
import type { ContractData } from "../../types/contract";
import {
  toFormValues,
  applyFormValues,
  type ContractFormValues,
} from "./contractSchema";
import { FormField } from "../../components/FormField";
import { Button } from "../../components/Button";
import { useEffect, useState } from "react";
interface ContractFormProps {
  contract: ContractData;
  onSubmit: (updated: ContractData) => void;
  onBack: () => void;
}

export function ContractForm({ contract, onSubmit, onBack }: ContractFormProps) {
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<ContractFormValues>({ defaultValues: toFormValues(contract) });

  const submit = handleSubmit((values) => {
    onSubmit(applyFormValues(contract, values));
  });

  // Brand / Validity / Temperature / Packing / Plant Number are PURE MIRROR
  // fields: locked by default, an admin can unlock to override them manually.
  const [mirrorUnlocked, setMirrorUnlocked] = useState(false);

  // Total Amount is always derived: recompute it the moment Quantity or Unit
  // Price changes so the user never types it and the value flows into the PDF.
  const quantity = watch("quantity");
  const unitPrice = watch("unitPrice");
  useEffect(() => {
    setValue("totalAmount", (Number(quantity) || 0) * (Number(unitPrice) || 0));
  }, [quantity, unitPrice, setValue]);

  // Packing mirrors the product line — "CONTAINER WITH <qty> <UNIT>" — so the
  // form display matches what the PDF renders. Skipped while unlocked so a
  // manual admin override is not clobbered on the next quantity/unit change.
  const unit = watch("unit");
  useEffect(() => {
    if (mirrorUnlocked) return;
    setValue("packing", `CONTAINER WITH ${Number(quantity) || 0} ${String(unit ?? "").toUpperCase()}`.trim());
  }, [quantity, unit, mirrorUnlocked, setValue]);

  // Prepayment advanced value is always 50% of the grand total. When the total
  // changes, rewrite only the "Advanced value: <amount>" number inside the
  // existing condition text (Paraguayan format), leaving the rest untouched.
  const prepaymentCondition = watch("prepaymentCondition");
  useEffect(() => {
    const cur = prepaymentCondition ?? "";
    if (!/Advanced value:/i.test(cur)) return; // no advanced-value token to sync
    const total = (Number(quantity) || 0) * (Number(unitPrice) || 0);
    const advanced = (total * 0.5).toLocaleString("de-DE", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    const next = cur.replace(/(Advanced value:\s*)[\d.,]+/i, `$1${advanced}`);
    if (next !== cur) setValue("prepaymentCondition", next);
  }, [quantity, unitPrice, prepaymentCondition, setValue]);

  return (
    <form onSubmit={submit}>
      <div className="section-title">Contract</div>
      <div className="grid-2">
        <FormField
          label="Contract Number"
          error={errors.contractNumber?.message}
          registration={register("contractNumber", { required: "Required" })}
        />
        <FormField
          label="Contract Date"
          type="date"
          registration={register("contractDate")}
        />
        <FormField label="Sales Person" registration={register("salesPerson")} />
        <FormField label="Sales Assistant" registration={register("salesAssistant")} />
      </div>

      <div className="section-title">Buyer / Client Information</div>
      <p style={{ margin: "0 0 12px", fontSize: 13, color: "#6b7280" }}>
        🔒 Client data is locked here. It is detected from the PDF and is the single
        source of truth — edit it only in the Clients module.
      </p>
      <div className="grid-2">
        <FormField label="Name" readOnly registration={register("buyerName")} />
        <FormField label="Country" readOnly registration={register("buyerCountry")} />
        <FormField label="Address" readOnly registration={register("buyerAddress")} />
        <FormField label="City" readOnly registration={register("buyerCity")} />
        <FormField label="Contact Person" readOnly registration={register("buyerContactPerson")} />
        <FormField label="Phone" readOnly registration={register("buyerPhone")} />
        <FormField label="Email" readOnly registration={register("buyerEmail")} />
      </div>

      <div className="section-title">Seller Information</div>
      <div className="grid-2">
        <FormField label="Name" error={errors.sellerName?.message} registration={register("sellerName", { required: "Required" })} />
        <FormField label="Country" registration={register("sellerCountry")} />
        <FormField label="Address" registration={register("sellerAddress")} />
        <FormField label="City" registration={register("sellerCity")} />
        <FormField label="VAT / R.U.C. Number" registration={register("sellerVatNumber")} />
        <FormField label="Email" registration={register("sellerEmail")} />
      </div>

      <div className="section-title">Product Details</div>
      <div className="grid-2">
        <FormField label="Commodity" error={errors.commodity?.message} registration={register("commodity", { required: "Required" })} />
        <FormField label="Unit" registration={register("unit")} />
        <FormField
          label="Quantity"
          type="number"
          registration={register("quantity", { required: "Required", valueAsNumber: true, min: { value: 0, message: "Must be ≥ 0" } })}
          error={errors.quantity?.message}
        />
        <FormField
          label="Unit Price"
          type="number"
          registration={register("unitPrice", { required: "Required", valueAsNumber: true, min: { value: 0, message: "Must be ≥ 0" } })}
          error={errors.unitPrice?.message}
        />
        <FormField
          label="Total Amount"
          type="number"
          registration={register("totalAmount", { valueAsNumber: true, min: { value: 0, message: "Must be ≥ 0" } })}
          error={errors.totalAmount?.message}
        />
        <FormField label="Currency" registration={register("currency")} />
        <FormField label="Incoterm" registration={register("incoterm")} />
      </div>

      <div className="section-title">Logistics</div>
      <div className="grid-2">
        <FormField label="Origin" registration={register("origin")} />
        <FormField label="Destination" registration={register("destination")} />
        <FormField label="Shipment Date" registration={register("shipmentDate")} />
        <FormField label="Freight Condition" registration={register("freightCondition")} />
      </div>

      <div className="section-title">Payment Terms</div>
      <FormField label="Prepayment Condition" registration={register("prepaymentCondition")} />
      <FormField label="Balance Condition" registration={register("balanceCondition")} />

      <div className="section-title">Banking Information</div>
      <div className="grid-2">
        <FormField label="Intermediary Bank" registration={register("interBankName")} />
        <FormField label="Intermediary SWIFT" registration={register("interSwift")} />
        <FormField label="Intermediary Account Number" registration={register("interAccountNumber")} />
        <FormField label="Intermediary Bank Address" registration={register("interAddress")} />
        <FormField label="Beneficiary Bank" registration={register("benBankName")} />
        <FormField label="Beneficiary Bank SWIFT" registration={register("benSwift")} />
        <FormField label="Beneficiary Account Number" registration={register("benAccountNumber")} />
      </div>
      <FormField label="Beneficiary" registration={register("beneficiary")} />

      <div className="section-title section-title-row">
        <span>Commercial Information</span>
        <button
          type="button"
          className="link-btn"
          onClick={() => setMirrorUnlocked((u) => !u)}
        >
          {mirrorUnlocked ? "Lock mirrored fields" : "Unlock to override"}
        </button>
      </div>
      <div className="grid-2">
        <FormField label="Brand" readOnly={!mirrorUnlocked} registration={register("brand")} />
        <FormField label="Validity" readOnly={!mirrorUnlocked} registration={register("validity")} />
        <FormField label="Temperature" readOnly={!mirrorUnlocked} registration={register("temperature")} />
        <FormField label="Packing" readOnly={!mirrorUnlocked} registration={register("packing")} />
        <FormField label="Plant Number" readOnly={!mirrorUnlocked} registration={register("plantNo")} />
        <FormField label="Law & Jurisdiction" registration={register("lawJurisdiction")} />
      </div>
      <FormField label="Notes" multiline registration={register("notes")} />

      <div className="row">
        <Button type="button" variant="secondary" onClick={onBack}>
          Back
        </Button>
        <Button type="submit">Generate PDF →</Button>
      </div>
    </form>
  );
}
