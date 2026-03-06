// app/api/billing/route.js — Subscription management
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { verifyToken } from '@/lib/middleware/auth';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder');
const BILLING_ROLES = ['CHAIRPERSON','FARM_ADMIN','SUPER_ADMIN'];

export async function GET(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!BILLING_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const subscription = await prisma.subscription.findUnique({
      where: { tenantId: user.tenantId },
      include: { plan: true },
    });
    const plans = await prisma.plan.findMany({
      where: { isPublic: true },
      orderBy: { monthlyPrice: 'asc' },
    });
    return NextResponse.json({ subscription, plans });
  } catch (error) {
    console.error('Billing fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch billing info' }, { status: 500 });
  }
}

export async function POST(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!BILLING_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  try {
    if (action === 'create_checkout') {
      const { planId, billingCycle } = await request.json();
      const plan = await prisma.plan.findUnique({ where: { id: planId } });
      if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 });

      const price = billingCycle === 'ANNUAL' ? plan.annualPrice : plan.monthlyPrice;

      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        payment_method_types: ['card'],
        line_items: [{
          price_data: {
            currency: 'usd',
            unit_amount: Math.round(Number(price) * 100),
            recurring: { interval: billingCycle === 'ANNUAL' ? 'year' : 'month' },
            product_data: {
              name: `PoultryFarm Pro — ${plan.name}`,
              description: `Up to ${plan.maxBirds.toLocaleString()} birds, ${plan.maxUsers} users`,
            },
          },
          quantity: 1,
        }],
        customer_email: user.email,
        metadata: { tenantId: user.tenantId, planId, billingCycle },
        success_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?upgraded=1`,
        cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/billing`,
      });

      return NextResponse.json({ checkoutUrl: session.url });
    }

    if (action === 'cancel') {
      const subscription = await prisma.subscription.findUnique({
        where: { tenantId: user.tenantId },
      });
      if (subscription?.stripeSubscriptionId) {
        await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
          cancel_at_period_end: true,
        });
      }
      await prisma.subscription.update({
        where: { tenantId: user.tenantId },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      });
      return NextResponse.json({ success: true, message: 'Subscription will cancel at period end' });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('Billing action error:', error);
    return NextResponse.json({ error: 'Billing operation failed' }, { status: 500 });
  }
}
