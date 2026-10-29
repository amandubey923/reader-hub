import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdminFirestore } from "@/lib/firebase-admin";
import { requireAdmin } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ uid: string }> }
) {
  try {
    const { uid } = await params;
    if (!uid) {
      return NextResponse.json({ error: "Missing uid parameter." }, { status: 400 });
    }

    // Admin token is mandatory: private reading data must never be served to anonymous callers
    const adminCheck = await requireAdmin(req.headers.get("authorization"));
    if (!adminCheck.ok) {
      return NextResponse.json({ error: adminCheck.error }, { status: adminCheck.status });
    }

    const adminDb = getFirebaseAdminFirestore();
    if (!adminDb) {
      return NextResponse.json({ error: "Database unavailable." }, { status: 503 });
    }

    // 1. Fetch user root doc & public profile doc
    const [userSnap, profSnap] = await Promise.all([
      adminDb.collection("users").doc(uid).get(),
      adminDb.collection("public_profiles").doc(uid).get(),
    ]);

    if (!userSnap.exists && !profSnap.exists) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    const userData = userSnap.data() || {};
    const profData = profSnap.data() || {};

    let lastLogin: number | undefined = undefined;
    if (userData.lastLoginAt) {
      if (typeof userData.lastLoginAt.toMillis === "function") {
        lastLogin = userData.lastLoginAt.toMillis();
      } else if (typeof userData.lastLoginAt === "number") {
        lastLogin = userData.lastLoginAt;
      }
    }

    // 2. Fetch subcollections using Admin SDK privileges
    const [favsSnap, progSnap, collSnap, refSnap, actSnap, activityDocSnap, activeTimeDocSnap] = await Promise.all([
      adminDb.collection("users").doc(uid).collection("favorites").get().catch(() => ({ docs: [] })),
      adminDb.collection("users").doc(uid).collection("reading_progress").get().catch(() => ({ docs: [] })),
      adminDb.collection("users").doc(uid).collection("data").doc("collections").get().catch(() => ({ exists: false, data: () => null })),
      adminDb.collection("users").doc(uid).collection("data").doc("reflections").get().catch(() => ({ exists: false, data: () => null })),
      adminDb.collection("public_activities").where("uid", "==", uid).limit(10).get().catch(() => ({ docs: [] })),
      adminDb.collection("users").doc(uid).collection("data").doc("activity").get().catch(() => ({ exists: false, data: () => null })),
      adminDb.collection("users").doc(uid).collection("data").doc("active_time").get().catch(() => ({ exists: false, data: () => null })),
    ]);

    // Format Favorites
    const favorites: string[] = [];
    favsSnap.docs.forEach((d: any) => {
      const dData = d.data();
      if (dData.isFavorite !== false) {
        favorites.push(d.id);
      }
    });

    // Format Reading Progress
    const readingProgress: Array<{
      bookId: string;
      page: number;
      totalPages: number;
      progress: number;
      lastReadAt?: number;
    }> = [];
    progSnap.docs.forEach((d: any) => {
      const p = d.data();
      readingProgress.push({
        bookId: d.id,
        page: p.currentPage || p.page || 0,
        totalPages: p.totalPages || 0,
        progress: typeof p.progress === "number" ? Math.round(p.progress) : 0,
        lastReadAt: p.lastReadAt || p.updatedAt,
      });
    });

    // Format Collections
    let collections: any[] = [];
    if (collSnap.exists && typeof (collSnap as any).data === "function") {
      const cData = (collSnap as any).data();
      if (Array.isArray(cData)) {
        collections = cData;
      } else if (cData?.collections && Array.isArray(cData.collections)) {
        collections = cData.collections;
      }
    }

    // Format Reflections
    let reflections: Record<string, any> = {};
    if (refSnap.exists && typeof (refSnap as any).data === "function") {
      reflections = (refSnap as any).data() || {};
    }

    // Format Activities
    const recentActivities: any[] = [];
    actSnap.docs.forEach((d: any) => {
      recentActivities.push({
        id: d.id,
        ...d.data(),
      });
    });
    recentActivities.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    // Real Activity, Reading Time & Streak
    let liveStreak = profData.stats?.currentStreak || 0;
    let liveLongest = profData.stats?.longestStreak || 0;
    let liveReadingSecs = profData.stats?.totalReadingSeconds || 0;
    if (activityDocSnap && (activityDocSnap as any).exists && typeof (activityDocSnap as any).data === "function") {
      const actData = (activityDocSnap as any).data();
      if (actData?.currentStreak !== undefined) liveStreak = Math.max(liveStreak, actData.currentStreak);
      if (actData?.longestStreak !== undefined) liveLongest = Math.max(liveLongest, actData.longestStreak);
      if (actData?.daily && typeof actData.daily === "object") {
        let sumSecs = 0;
        Object.values(actData.daily).forEach((d: any) => {
          sumSecs += Number(d?.seconds) || 0;
        });
        liveReadingSecs = Math.max(liveReadingSecs, sumSecs);
      }
    }

    // Real Active Time
    let liveActiveSecs = Math.max(profData.stats?.totalActiveSeconds || 0, liveReadingSecs);
    if (activeTimeDocSnap && (activeTimeDocSnap as any).exists && typeof (activeTimeDocSnap as any).data === "function") {
      const atData = (activeTimeDocSnap as any).data();
      if (atData?.totalActiveSeconds !== undefined) liveActiveSecs = Math.max(liveActiveSecs, atData.totalActiveSeconds, liveReadingSecs);
    }

    // Accurate book counts
    const completedCount = readingProgress.filter(
      (p) => p.progress >= 95 || (p.totalPages > 0 && p.page >= p.totalPages)
    ).length;
    const readingCount = readingProgress.filter(
      (p) => p.progress > 0 && p.progress < 95 && (p.totalPages <= 0 || p.page < p.totalPages)
    ).length;

    const cleanDisplayName = (userData.displayName || profData.displayName || profData.username || "Reader").replace(/^@+/, "").trim();

    const inspectionData = {
      uid,
      email: userData.email || "No email",
      displayName: cleanDisplayName,
      username: profData.username || userData.username || `reader_${uid.slice(0, 6)}`,
      photoURL: userData.photoURL || profData.photoURL || "",
      bio: userData.bio || profData.bio || "",
      lastLoginAt: lastLogin,
      lastActiveAt: userData.lastActiveAt,
      createdAt: userData.createdAt,
      booksCompleted: completedCount,
      currentlyReading: readingCount,
      currentStreak: liveStreak,
      longestStreak: liveLongest,
      totalReadingSeconds: liveReadingSecs,
      totalActiveSeconds: liveActiveSecs,
      followersCount: profData.followersCount || 0,
      followingCount: profData.followingCount || 0,
      isPublic: profData.isPublic !== false,
      favorites,
      collections,
      readingProgress,
      reflections,
      recentActivities,
    };

    return NextResponse.json({ user: inspectionData });
  } catch (err: any) {
    console.error("[Admin API] /api/admin/users/[uid] error:", err);
    return NextResponse.json({ error: "Failed to load user inspection data." }, { status: 500 });
  }
}
