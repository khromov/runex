<!--
  Styling with CSS only: a <style> block, class: directives, style: directives, :hover/:active,
  gradients, shadows and var() theming. Every property here becomes an El builder call.
-->
<script lang="ts">
  import { theme, apply_theme } from "./theme.svelte.ts"

  const plans = [
    { name: "Hobby", price: 0, blurb: "For side projects", features: ["1 project", "Community support"] },
    { name: "Pro", price: 20, blurb: "For professionals", features: ["Unlimited projects", "Email support", "Analytics"] },
    { name: "Team", price: 50, blurb: "For growing teams", features: ["Everything in Pro", "SSO", "Audit log"] },
  ]
  let chosen = $state(1)
</script>

<div class="page">
  <header class="top">
    <div class="titles">
      <h1>Pricing</h1>
      <span class="muted">Pick the plan that fits. Change it any time.</span>
    </div>
    <div
      key="theme"
      class="toggle"
      onpress={() => apply_theme(theme.name === "dark" ? "light" : "dark")}
    >
      <span>{theme.name === "dark" ? "Dark" : "Light"}</span>
    </div>
  </header>

  <div class="plans">
    {#each plans as plan, i (plan.name)}
      <div key="plan-{i}" class="plan" class:chosen={chosen === i} onpress={() => (chosen = i)}>
        <span class="name">{plan.name}</span>
        <div class="price-row">
          <span class="price">${plan.price}</span>
          <span class="muted">/month</span>
        </div>
        <span class="muted">{plan.blurb}</span>
        <div class="rule"></div>
        {#each plan.features as feature}
          <div class="feature">
            <div class="dot" style:background={chosen === i ? "var(--accent2)" : "var(--muted)"}></div>
            <span>{feature}</span>
          </div>
        {/each}
        <div class="spacer"></div>
        <div class="cta" class:primary={chosen === i}>
          <span>{chosen === i ? "Current plan" : "Choose"}</span>
        </div>
      </div>
    {/each}
  </div>
</div>

<style>
  .page {
    width: 100%;
    height: 100%;
    padding: 32px;
    gap: 24px;
    background: var(--bg);
    color: var(--text);
  }
  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .titles {
    gap: 6px;
  }
  .muted {
    color: var(--muted);
    font-size: 13px;
  }
  .toggle {
    padding: 8px 14px;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: var(--card);
    font-size: 13px;
    cursor: pointer;
  }
  .toggle:hover {
    background: var(--border);
  }
  .plans {
    display: flex;
    gap: 16px;
    flex: 1;
  }
  .plan {
    flex: 1;
    padding: 20px;
    gap: 10px;
    border-radius: 14px;
    background: var(--card);
    border: 1px solid var(--border);
    cursor: pointer;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.18);
  }
  .plan:hover {
    background: var(--border);
  }
  .plan.chosen {
    border: 2px solid var(--accent);
    box-shadow: 0 12px 32px rgba(124, 92, 255, 0.35);
  }
  .name {
    font-size: 14px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--accent2);
  }
  .price-row {
    display: flex;
    align-items: flex-end;
    gap: 4px;
  }
  .price {
    font-size: 36px;
    font-weight: 700;
  }
  .rule {
    height: 1px;
    width: 100%;
    background: var(--border);
    margin: 6px 0;
  }
  .feature {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
  }
  .spacer {
    flex: 1;
  }
  .cta {
    padding: 10px;
    border-radius: 8px;
    align-items: center;
    border: 1px solid var(--border);
    font-size: 13px;
    font-weight: 600;
  }
  .cta.primary {
    background: linear-gradient(90deg, var(--accent), var(--accent2));
    border: none;
    color: #ffffff;
  }
</style>
