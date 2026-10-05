-- Normalize persisted Markup contract after legacy code treated markup as target gross margin.
-- Official contract:
--   Markup % = (customer price - cost price) / cost price * 100
--   Customer price = cost price * (1 + markup / 100)
--
-- This migration audits old/new rows before updating persisted catalog defaults
-- and quote items, including approved historical quotes. The audit table is kept
-- intentionally for rollback/reconciliation.

CREATE TABLE IF NOT EXISTS public.markup_contract_backfill_audit_150 (
    id BIGSERIAL PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id UUID NOT NULL,
    parent_id UUID,
    quote_status TEXT,
    old_record JSONB NOT NULL,
    new_record JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS markup_contract_backfill_audit_150_entity_idx
    ON public.markup_contract_backfill_audit_150 (entity_type, entity_id);

-- Service Catalog default price backfill.
WITH catalog_backfill AS (
    SELECT
        p.id,
        ROUND(p.default_cost_price_vnd * (1 + p.default_markup_percent / 100), 0) AS new_customer_price_vnd
    FROM public.service_catalog_item_pricing p
    WHERE p.default_cost_price_vnd IS NOT NULL
      AND p.default_markup_percent IS NOT NULL
      AND p.default_markup_percent >= -100
), catalog_changed AS (
    SELECT p.*, b.new_customer_price_vnd
    FROM public.service_catalog_item_pricing p
    JOIN catalog_backfill b ON b.id = p.id
    WHERE p.default_customer_price_vnd IS DISTINCT FROM b.new_customer_price_vnd
), catalog_audit AS (
    INSERT INTO public.markup_contract_backfill_audit_150 (entity_type, entity_id, parent_id, old_record, new_record)
    SELECT
        'service_catalog_item_pricing',
        c.id,
        c.service_catalog_item_id,
        to_jsonb(c) - 'new_customer_price_vnd',
        jsonb_build_object(
            'default_customer_price_vnd', c.new_customer_price_vnd,
            'contract', 'customer = cost * (1 + markup / 100)'
        )
    FROM catalog_changed c
    RETURNING entity_id
)
UPDATE public.service_catalog_item_pricing p
SET default_customer_price_vnd = c.new_customer_price_vnd,
    updated_at = now()
FROM catalog_changed c
WHERE p.id = c.id;

-- Quote item persisted price backfill. Covers draft/approved/cancelled/etc. because
-- historical approved quotes were also calculated with the old formula.
CREATE TEMP TABLE _markup_contract_quote_item_backfill ON COMMIT DROP AS
SELECT
    qi.id,
    qi.quote_id,
    q.status AS quote_status,
    ROUND(qi.cost_price * (1 + qi.markup_percent / 100), 0) AS new_unit_price,
    ROUND(COALESCE(qi.quantity, 0) * ROUND(qi.cost_price * (1 + qi.markup_percent / 100), 0), 0) AS new_subtotal_amount,
    ROUND(
        ROUND(COALESCE(qi.quantity, 0) * ROUND(qi.cost_price * (1 + qi.markup_percent / 100), 0), 0)
        * COALESCE(qi.discount_percent, 0) / 100,
        0
    ) AS new_discount_amount,
    ROUND(COALESCE(qi.quantity, 0) * ROUND(qi.cost_price * (1 + qi.markup_percent / 100), 0), 0)
      - ROUND(
          ROUND(COALESCE(qi.quantity, 0) * ROUND(qi.cost_price * (1 + qi.markup_percent / 100), 0), 0)
          * COALESCE(qi.discount_percent, 0) / 100,
          0
        ) AS new_amount_after_discount,
    ROUND(
        (
            ROUND(COALESCE(qi.quantity, 0) * ROUND(qi.cost_price * (1 + qi.markup_percent / 100), 0), 0)
            - ROUND(
                ROUND(COALESCE(qi.quantity, 0) * ROUND(qi.cost_price * (1 + qi.markup_percent / 100), 0), 0)
                * COALESCE(qi.discount_percent, 0) / 100,
                0
              )
        ) * COALESCE(qi.vat_rate, 0) / 100,
        0
    ) AS new_vat_amount,
    (
        ROUND(COALESCE(qi.quantity, 0) * ROUND(qi.cost_price * (1 + qi.markup_percent / 100), 0), 0)
        - ROUND(
            ROUND(COALESCE(qi.quantity, 0) * ROUND(qi.cost_price * (1 + qi.markup_percent / 100), 0), 0)
            * COALESCE(qi.discount_percent, 0) / 100,
            0
          )
    ) + ROUND(
        (
            ROUND(COALESCE(qi.quantity, 0) * ROUND(qi.cost_price * (1 + qi.markup_percent / 100), 0), 0)
            - ROUND(
                ROUND(COALESCE(qi.quantity, 0) * ROUND(qi.cost_price * (1 + qi.markup_percent / 100), 0), 0)
                * COALESCE(qi.discount_percent, 0) / 100,
                0
              )
        ) * COALESCE(qi.vat_rate, 0) / 100,
        0
    ) AS new_total_amount
FROM public.quote_items qi
JOIN public.quotes q ON q.id = qi.quote_id
WHERE COALESCE(qi.row_type, 'item') <> 'section'
  AND COALESCE(qi.cost_not_applicable, false) = false
  AND qi.cost_price IS NOT NULL
  AND qi.markup_percent IS NOT NULL
  AND qi.markup_percent >= -100;

DELETE FROM _markup_contract_quote_item_backfill b
USING public.quote_items qi
WHERE qi.id = b.id
  AND qi.unit_price IS NOT DISTINCT FROM b.new_unit_price
  AND qi.subtotal_amount IS NOT DISTINCT FROM b.new_subtotal_amount
  AND qi.discount_amount IS NOT DISTINCT FROM b.new_discount_amount
  AND qi.amount_after_discount IS NOT DISTINCT FROM b.new_amount_after_discount
  AND qi.vat_amount IS NOT DISTINCT FROM b.new_vat_amount
  AND qi.total_amount IS NOT DISTINCT FROM b.new_total_amount;

INSERT INTO public.markup_contract_backfill_audit_150 (entity_type, entity_id, parent_id, quote_status, old_record, new_record)
SELECT
    'quote_item',
    qi.id,
    qi.quote_id,
    b.quote_status,
    to_jsonb(qi),
    jsonb_build_object(
        'unit_price', b.new_unit_price,
        'subtotal_amount', b.new_subtotal_amount,
        'discount_amount', b.new_discount_amount,
        'amount_after_discount', b.new_amount_after_discount,
        'vat_amount', b.new_vat_amount,
        'total_amount', b.new_total_amount,
        'contract', 'customer = cost * (1 + markup / 100)'
    )
FROM public.quote_items qi
JOIN _markup_contract_quote_item_backfill b ON b.id = qi.id;

UPDATE public.quote_items qi
SET unit_price = b.new_unit_price,
    subtotal_amount = b.new_subtotal_amount,
    discount_amount = b.new_discount_amount,
    amount_after_discount = b.new_amount_after_discount,
    vat_amount = b.new_vat_amount,
    total_amount = b.new_total_amount
FROM _markup_contract_quote_item_backfill b
WHERE qi.id = b.id;

CREATE TEMP TABLE _markup_contract_quote_totals ON COMMIT DROP AS
SELECT
    q.id,
    q.status AS quote_status,
    COALESCE(SUM(qi.subtotal_amount), 0) AS new_subtotal_amount,
    COALESCE(SUM(qi.vat_amount), 0) AS new_vat_amount,
    COALESCE(SUM(qi.total_amount), 0) AS new_total_amount
FROM public.quotes q
JOIN (SELECT DISTINCT quote_id FROM _markup_contract_quote_item_backfill) changed ON changed.quote_id = q.id
LEFT JOIN public.quote_items qi ON qi.quote_id = q.id
GROUP BY q.id, q.status;

INSERT INTO public.markup_contract_backfill_audit_150 (entity_type, entity_id, quote_status, old_record, new_record)
SELECT
    'quote',
    q.id,
    t.quote_status,
    jsonb_build_object(
        'subtotal_amount', q.subtotal_amount,
        'vat_amount', q.vat_amount,
        'total_amount', q.total_amount
    ),
    jsonb_build_object(
        'subtotal_amount', t.new_subtotal_amount,
        'vat_amount', t.new_vat_amount,
        'total_amount', t.new_total_amount
    )
FROM public.quotes q
JOIN _markup_contract_quote_totals t ON t.id = q.id
WHERE q.subtotal_amount IS DISTINCT FROM t.new_subtotal_amount
   OR q.vat_amount IS DISTINCT FROM t.new_vat_amount
   OR q.total_amount IS DISTINCT FROM t.new_total_amount;

UPDATE public.quotes q
SET subtotal_amount = t.new_subtotal_amount,
    vat_amount = t.new_vat_amount,
    total_amount = t.new_total_amount
FROM _markup_contract_quote_totals t
WHERE q.id = t.id;
