package apikeys

import (
	"context"
	"fmt"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// syncedKeyPointerPK is the companion item PK mapping a stable external
// CompliWise keyId to the current key secret (the live record's PK). The api
// sends only the keyId on revoke, and a re-upsert may rotate the secret, so we
// keep this pointer to find and clean up the underlying record. Its own PK
// carries no recognized key prefix, so it never resolves as a request key.
func syncedKeyPointerPK(keyID string) string {
	return "cwkey:" + keyID
}

// UpsertSyncedKey creates or overwrites a CompliWise-synced gateway key record,
// keyed by the customer-facing secret, plus a keyId->secret pointer. Unlike
// CreateKey it does NOT generate a key or use an attribute_not_exists condition:
// the secret is supplied by the CompliWise api and upserts must be idempotent.
func (s *Store) UpsertSyncedKey(ctx context.Context, keyID, secret string, rec APIKey) (*APIKey, error) {
	if secret == "" {
		return nil, fmt.Errorf("synced key secret is empty")
	}

	// If a prior record exists for this keyId under a different secret, drop the
	// stale record so a rotated secret doesn't orphan the old one.
	if prev, err := s.getSyncedKeySecret(ctx, keyID); err == nil && prev != "" && prev != secret {
		_, _ = s.client.DeleteItem(ctx, &dynamodb.DeleteItemInput{
			TableName: aws.String(s.tableName),
			Key:       map[string]types.AttributeValue{"pk": &types.AttributeValueMemberS{Value: prev}},
		})
	}

	now := time.Now()
	rec.PK = secret
	if rec.CreatedAt.IsZero() {
		rec.CreatedAt = now
	}
	rec.UpdatedAt = now
	rec.Enabled = true

	av, err := attributevalue.MarshalMap(&rec)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal synced key: %w", err)
	}
	if _, err := s.client.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(s.tableName),
		Item:      av,
	}); err != nil {
		return nil, fmt.Errorf("failed to upsert synced key: %w", err)
	}

	// Pointer item: pk="cwkey:<keyId>", secret stashed in actual_key.
	ptr := APIKey{PK: syncedKeyPointerPK(keyID), ActualKey: secret, Enabled: false, CreatedAt: now, UpdatedAt: now}
	if pav, perr := attributevalue.MarshalMap(&ptr); perr == nil {
		_, _ = s.client.PutItem(ctx, &dynamodb.PutItemInput{TableName: aws.String(s.tableName), Item: pav})
	}

	s.logger.Info("Upserted CompliWise synced key", "key", RedactKey(secret), "provider", rec.Provider, "key_id", keyID)
	return &rec, nil
}

// getSyncedKeySecret resolves the current secret for a CompliWise keyId via the
// pointer item. Returns "" (nil error) when no pointer exists.
func (s *Store) getSyncedKeySecret(ctx context.Context, keyID string) (string, error) {
	out, err := s.client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(s.tableName),
		Key:       map[string]types.AttributeValue{"pk": &types.AttributeValueMemberS{Value: syncedKeyPointerPK(keyID)}},
	})
	if err != nil || out.Item == nil {
		return "", err
	}
	var ptr APIKey
	if err := attributevalue.UnmarshalMap(out.Item, &ptr); err != nil {
		return "", err
	}
	return ptr.ActualKey, nil
}

// RevokeSyncedKeyByID deletes the synced key record and its pointer for a
// CompliWise keyId. It is a no-op (nil) when nothing is found.
func (s *Store) RevokeSyncedKeyByID(ctx context.Context, keyID string) error {
	secret, err := s.getSyncedKeySecret(ctx, keyID)
	if err != nil {
		return err
	}
	if secret != "" {
		_, _ = s.client.DeleteItem(ctx, &dynamodb.DeleteItemInput{
			TableName: aws.String(s.tableName),
			Key:       map[string]types.AttributeValue{"pk": &types.AttributeValueMemberS{Value: secret}},
		})
	}
	_, _ = s.client.DeleteItem(ctx, &dynamodb.DeleteItemInput{
		TableName: aws.String(s.tableName),
		Key:       map[string]types.AttributeValue{"pk": &types.AttributeValueMemberS{Value: syncedKeyPointerPK(keyID)}},
	})
	s.logger.Info("Revoked CompliWise synced key", "key_id", keyID)
	return nil
}
