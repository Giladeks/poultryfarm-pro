// app/api/billing/webhook/route.js — Stripe webhook event handler
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder');

export async function POST(request) {
  const sig = request.headers.get('stripe-signature');
  const body = await request.text();

  let event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const { tenantId, planId, billingCycle } = session.metadata;

        if (!tenantId) break;

        const plan = await prisma.plan.findUnique({ where: { id: planId } });
        const periodEnd = new Date();
        periodEnd.setMonth(periodEnd.getMonth() + (billingCycle === 'ANNUAL' ? 12 : 1));

        await prisma.subscription.update({
          where: { tenantId },
          data: {
            planId,
            stripeSubscriptionId: session.subscription,
            billingCycle,
            currentPeriodStart: new Date(),
            currentPeriodEnd: periodEnd,
            status: 'ACTIVE',
            trialEndsAt: null,
          },
        });

        await prisma.tenant.update({
          where: { id: tenantId },
          data: { status: 'ACTIVE' },
        });

        console.log(`[STRIPE] Subscription activated for tenant ${tenantId} on ${plan?.name} plan`);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const subscription = await prisma.subscription.findFirst({
          where: { stripeSubscriptionId: invoice.subscription },
        });

        if (subscription) {
          await prisma.subscription.update({
            where: { id: subscription.id },
            data: { status: 'PAST_DUE' },
          });
          console.log(`[STRIPE] Payment failed for tenant ${subscription.tenantId}`);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const subscription = await prisma.subscription.findFirst({
          where: { stripeSubscriptionId: sub.id },
        });

        if (subscription) {
          await prisma.subscription.update({
            where: { id: subscription.id },
            data: { status: 'CANCELLED' },
          });
          await prisma.tenant.update({
            where: { id: subscription.tenantId },
            data: { status: 'CANCELLED' },
          });
        }
        break;
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const subscription = await prisma.subscription.findFirst({
          where: { stripeSubscriptionId: sub.id },
        });

        if (subscription) {
          await prisma.subscription.update({
            where: { id: subscription.id },
            data: {
              status: sub.status === 'active' ? 'ACTIVE' : 'PAST_DUE',
              currentPeriodEnd: new Date(sub.current_period_end * 1000),
            },
          });
        }
        break;
      }

      default:
        console.log(`[STRIPE] Unhandled event: ${event.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Webhook handler error:', error);
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}
