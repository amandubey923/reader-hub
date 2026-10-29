import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdminFirestore } from "@/lib/firebase-admin";
import { getVerifiedCaller } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/users/follow?uid=<uid>
 * Returns authentic aggregate follower and following counts directly from the follows collection.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const uid = searchParams.get("uid");
  const followerUid = searchParams.get("followerUid");
  const targetUid = searchParams.get("targetUid");

  const adminDb = getFirebaseAdminFirestore();
  if (!adminDb) {
    return NextResponse.json({ error: "Database unavailable." }, { status: 503 });
  }

  // 1. Direct follow relationship check (100% authoritative server confirmation)
  if (followerUid && targetUid) {
    try {
      const followId = `${followerUid}_${targetUid}`;
      const followDoc = await adminDb.collection("follows").doc(followId).get();
      return NextResponse.json({
        followerUid,
        targetUid,
        isFollowing: followDoc.exists,
      });
    } catch (err: any) {
      console.error("[Follow API GET] Error checking relationship:", err);
      return NextResponse.json({ error: "Failed to check follow status." }, { status: 500 });
    }
  }

  if (!uid) {
    return NextResponse.json({ error: "Missing uid parameter." }, { status: 400 });
  }

  try {
    const [followersSnap, followingSnap] = await Promise.all([
      adminDb.collection("follows").where("followingUid", "==", uid).count().get(),
      adminDb.collection("follows").where("followerUid", "==", uid).count().get(),
    ]);

    const followersCount = followersSnap.data().count || 0;
    const followingCount = followingSnap.data().count || 0;

    const includeList = searchParams.get("list") === "true";
    let followers: any[] = [];
    let following: any[] = [];

    if (includeList) {
      const [followersListSnap, followingListSnap] = await Promise.all([
        adminDb.collection("follows").where("followingUid", "==", uid).limit(50).get(),
        adminDb.collection("follows").where("followerUid", "==", uid).limit(50).get(),
      ]);

      const followerUids = followersListSnap.docs.map((d) => d.data().followerUid).filter(Boolean);
      const followingUids = followingListSnap.docs.map((d) => d.data().followingUid).filter(Boolean);

      const fetchProfiles = async (uids: string[]) => {
        if (uids.length === 0) return [];
        const snaps = await Promise.all(uids.map((u) => adminDb.collection("public_profiles").doc(u).get()));
        return snaps
          .map((snap) => {
            if (!snap.exists) return null;
            const data = snap.data() || {};
            return {
              uid: snap.id,
              username: data.username || "reader",
              displayName: data.displayName || "Reader",
              photoURL: data.photoURL || undefined,
              bio: data.bio || undefined,
              followersCount: data.followersCount || 0,
              followingCount: data.followingCount || 0,
              readingStreak: data.stats?.currentStreak ?? data.readingStreak ?? 0,
              booksCompleted: data.stats?.booksCompleted ?? data.booksCompleted ?? 0,
              totalReadingSeconds: data.stats?.totalReadingSeconds ?? data.totalReadingSeconds ?? 0,
            };
          })
          .filter(Boolean);
      };

      [followers, following] = await Promise.all([
        fetchProfiles(followerUids),
        fetchProfiles(followingUids),
      ]);
    }

    return NextResponse.json({
      uid,
      followersCount,
      followingCount,
      followers: includeList ? followers : undefined,
      following: includeList ? following : undefined,
    });
  } catch (err: any) {
    console.error("[Follow API GET] Error counting follows:", err);
    return NextResponse.json({ error: "Failed to retrieve follow counts." }, { status: 500 });
  }
}

/**
 * POST /api/users/follow
 * Handles follow/unfollow actions with Firebase Admin privileges,
 * updating the follows collection and synchronizing public_profiles counts.
 */
export async function POST(req: NextRequest) {
  const adminDb = getFirebaseAdminFirestore();
  if (!adminDb) {
    return NextResponse.json({ error: "Database unavailable." }, { status: 503 });
  }

  try {
    const caller = await getVerifiedCaller(req.headers.get("authorization"));
    if (!caller) {
      return NextResponse.json({ error: "Unauthorized. Please sign in to follow readers." }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { followerUid, targetUid, action } = body;

    if (typeof followerUid !== "string" || typeof targetUid !== "string" || !followerUid || !targetUid) {
      return NextResponse.json({ error: "Missing followerUid or targetUid." }, { status: 400 });
    }

    // Readers may only follow or unfollow on their own behalf
    if (followerUid !== caller.uid) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    if (followerUid === targetUid) {
      return NextResponse.json({ error: "Cannot follow yourself." }, { status: 400 });
    }

    if (action !== "follow" && action !== "unfollow") {
      return NextResponse.json({ error: "Invalid action. Must be 'follow' or 'unfollow'." }, { status: 400 });
    }

    const followId = `${followerUid}_${targetUid}`;
    const followDocRef = adminDb.collection("follows").doc(followId);

    if (action === "follow") {
      await followDocRef.set({
        followerUid,
        followingUid: targetUid,
        createdAt: Date.now(),
      });
    } else {
      await followDocRef.delete();
    }

    // Compute updated authentic counts for both users
    const [targetFollowersSnap, targetFollowingSnap, followerFollowersSnap, followerFollowingSnap] =
      await Promise.all([
        adminDb.collection("follows").where("followingUid", "==", targetUid).count().get(),
        adminDb.collection("follows").where("followerUid", "==", targetUid).count().get(),
        adminDb.collection("follows").where("followingUid", "==", followerUid).count().get(),
        adminDb.collection("follows").where("followerUid", "==", followerUid).count().get(),
      ]);

    const targetFollowers = targetFollowersSnap.data().count || 0;
    const targetFollowing = targetFollowingSnap.data().count || 0;
    const followerFollowers = followerFollowersSnap.data().count || 0;
    const followerFollowing = followerFollowingSnap.data().count || 0;

    // Synchronize public_profiles docs in background with Admin SDK
    const enrichAndSyncProfile = async (uid: string, followers: number, following: number) => {
      const pDoc = await adminDb.collection("public_profiles").doc(uid).get();
      const pData = pDoc.exists ? pDoc.data() || {} : {};

      const updatePayload: Record<string, any> = {
        followersCount: followers,
        followingCount: following,
        updatedAt: Date.now(),
      };

      if (!pData.username || !pData.displayName) {
        const uDoc = await adminDb.collection("users").doc(uid).get();
        if (uDoc.exists) {
          const uData = uDoc.data() || {};
          if (uData.username) updatePayload.username = uData.username;
          if (uData.displayName) updatePayload.displayName = uData.displayName.replace(/^@+/, "").trim();
          if (uData.photoURL) updatePayload.photoURL = uData.photoURL;
        }
      }

      await adminDb.collection("public_profiles").doc(uid).set(updatePayload, { merge: true });
    };

    await Promise.allSettled([
      enrichAndSyncProfile(targetUid, targetFollowers, targetFollowing),
      enrichAndSyncProfile(followerUid, followerFollowers, followerFollowing),
    ]);

    return NextResponse.json({
      success: true,
      isFollowing: action === "follow",
      targetUid,
      targetFollowers,
      targetFollowing,
      followerUid,
      followerFollowers,
      followerFollowing,
    });
  } catch (err: any) {
    console.error("[Follow API POST] Error executing follow action:", err);
    return NextResponse.json({ error: "Follow action failed." }, { status: 500 });
  }
}

