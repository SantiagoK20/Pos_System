<?php

namespace Tests\Unit;

use App\Services\FirebaseSupabaseClaims;
use Kreait\Firebase\Contract\Auth;
use Tests\TestCase;

class FirebaseSupabaseClaimsTest extends TestCase
{
    public function test_it_adds_the_supabase_role_without_dropping_other_claims(): void
    {
        $auth = $this->createMock(Auth::class);
        $auth->expects($this->once())
            ->method('setCustomUserClaims')
            ->with('firebase-uid', [
                'department' => 'kitchen',
                'role' => 'authenticated',
            ]);

        $claims = new FirebaseSupabaseClaims($auth);

        $this->assertTrue($claims->ensureAuthenticatedRole('firebase-uid', [
            'department' => 'kitchen',
        ]));
    }

    public function test_it_does_not_rewrite_a_user_who_already_has_the_required_role(): void
    {
        $auth = $this->createMock(Auth::class);
        $auth->expects($this->never())->method('setCustomUserClaims');

        $claims = new FirebaseSupabaseClaims($auth);

        $this->assertFalse($claims->ensureAuthenticatedRole('firebase-uid', [
            'role' => 'authenticated',
        ]));
    }
}
