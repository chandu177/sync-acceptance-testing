const datasetId = 'specDataset';
const datasetOneId = 'specDatasetOne';
const datasetTwoId = 'specDatasetTwo';
const testData = { test: 'text' };
const updateData = { test: 'something else' };

describe('Sync Create/Update/Delete', function() {

  beforeAll(function(done) {
    localStorage.clear();
    $fh.cloud({
      path: '/datasets',
      data: {
        name: 'specDataset',
        options: { syncFrequency: 0.5 }
      }
    }, done, done.fail);
  });

  beforeEach(function() {
    $fh.sync.init({ sync_frequency: 0.5, storage_strategy: 'dom' , crashed_count_wait: 1});
  });

  afterEach(function(done) {
    var datasets = [datasetId, datasetOneId, datasetTwoId];
    var datasetsStopped = 0;

    function datasetStopped() {
      datasetsStopped++;
      if (datasetsStopped === datasets.length) {
        localStorage.clear();
        return done();
      }
    }

    datasets.forEach(function(dataset) {
      $fh.sync.stopSync(dataset, function() {
        datasetStopped();
      }, function() {
        console.info('Problem stopping sync for dataset ' + dataset + '. This can be ignored if the dataset was not "managed" in the test');
        datasetStopped();
      });
    });

  });

  afterAll(function() {
    return removeDataset(datasetId)();
  });

  it('should manage a dataset', function() {
    $fh.sync.manage(datasetId);
    return waitForSyncEvent('sync_complete')();
  });

  it('should list', function() {
    return manage(datasetId)
    .then(waitForSyncEvent('sync_started'))
    .then(function verifySyncStarted(event) {
      expect(event.dataset_id).toEqual(datasetId);
      expect(event.message).toBeNull();
    })
    .then(waitForSyncEvent('sync_complete'))
    .then(function verifySyncCompleted(event) {
      expect(event.dataset_id).toEqual(datasetId);
      expect(event.message).toEqual('online');
    });
  });

  it('should create', function() {
    // set up a notifier that only handles `local_update_applied' events as these might
    // occur before the 'then' part of the following promise being called.
    $fh.sync.notify(function(event) {
      if (event.code === 'local_update_applied') {
        expect(event.dataset_id).toEqual(datasetId);
        expect(event.message).toMatch(/(load|create)/);
      }
    });
    return manage(datasetId)
    .then(doCreate(datasetId, testData))
    .then(function(res) {
      expect(res.action).toEqual('create');
      expect(res.post).toEqual(testData);
    })
    .then(waitForSyncEvent('remote_update_applied'))
    .then(function verifyUpdateApplied(event) {
      expect(event.dataset_id).toEqual(datasetId);
      expect(event.message.type).toEqual('applied');
      expect(event.message.action).toEqual('create');
    });
  });

  it('should read', function() {
    return manage(datasetId)
    .then(doCreate(datasetId, testData))
    .then(function withResult(res) {
      const uid = res.uid;
      return doRead(datasetId, uid)
      .then(function verifyData(data) {
        expect(data.data).toEqual(testData);
        expect(data.hash).not.toBeNull();
      });
    })
    .catch(function(err) {
      expect(err).toBeNull();
    });
  });

  it('should fail when reading unknown uid', function() {
    return manage(datasetId)
    .then(doCreate(datasetId, testData))
    .then(function withResult() {
      return doRead(datasetId, 'bogus_uid');
    })
    .catch(function verifyError(err) {
      expect(err).toEqual('unknown_uid');
    });
  });

  it('should update', function() {
    return manage(datasetId)
    .then(doCreate(datasetId, testData))
    .then(function withResult(res) {
      const uid = res.uid;
      return doUpdate(datasetId, uid, updateData)
      .then(doRead(datasetId, uid))
      .then(function verifyUpdate(data) {
        expect(data).toEqual(updateData);
      });
    })
    .catch(function(err) {
      expect(err).toBeNull();
    });
  });

  it('should delete', function() {
    return manage(datasetId)
      .then(doCreate(datasetId, testData))
      .then(function withResult(res) {
        const uid = res.uid;
        return doDelete(datasetId, uid)
        .then(doRead(datasetId, uid).catch(function(err) {
          expect(err).toEqual('unknown_uid');
        }));
      });
  });

  it('should create records created by other clients', function() {
    const recordToCreate = { test: 'create' };

    return manage(datasetId)
    .then(createRecord(datasetId, recordToCreate))
    .then(waitForSyncEvent('record_delta_received'))
    .then(function verifyDeltaStructure(event) {
      expect(event.uid).not.toBeNull();
      expect(event.message).toEqual('create');
      expect(event.dataset_id).toEqual(datasetId);
      return doRead(datasetId, event.uid)
      .then(function verifyCorrectRecordApplied(record) {
        expect(record.data).toEqual(recordToCreate);
      })
      .catch(function(err) {
        expect(err).toBeNull();
      });
    });
  });

  it('should update records updated by other clients', function() {
    const updateData = { test: 'cause a client update' };

    return manage(datasetId)
    .then(doCreate(datasetId, testData))
    .then(waitForSyncEvent('remote_update_applied'))
    .then(function verifyUpdateApplied(event) {
      const uid = event.uid;
      return updateRecord(datasetId, uid, updateData)
      .then(waitForSyncEvent('record_delta_received'))
      .then(function verifyDeltaStructure(event) {
        expect(event.message).toEqual('update');
        return doRead(datasetId, event.uid);
      })
      .then(function verifyRecordUpdated(record) {
        expect(record.data).toEqual(updateData);
      });
    })
    .catch(function(err) {
      expect(err).toBeNull();
    });
  });

  it('should manage multiple datasets', function() {

    const recordOne = { test: 'recordOne' };
    const recordTwo = { test: 'recordTwo' };
    // We will use these to get the record from `doList` later.
    var recordOneHash;
    var recordTwoHash;

    return manage(datasetOneId)
    .then(manage(datasetTwoId))
    .then(doCreate(datasetOneId, recordOne))
    .then(waitForSyncEvent('remote_update_applied'))
    .then(function setRecordTwoHash(event) {
      expect(event.uid).not.toBeNull();
      recordOneHash = event.uid;
    })
    .then(doCreate(datasetTwoId, recordTwo))
    .then(waitForSyncEvent('remote_update_applied'))
    .then(function setRecordTwoHash(event) {
      expect(event.uid).not.toBeNull();
      recordTwoHash = event.uid;
    })
    .then(doList(datasetOneId))
    .then(function verifyDatasetOneUpdates(records) {
      expect(records[recordTwoHash]).not.toBeDefined();
      expect(records[recordOneHash]).not.toBeNull();
      expect(records[recordOneHash].data).toEqual(recordOne);
    })
    .then(doList(datasetTwoId))
    .then(function verifyDatasetTwoUpdates(records) {
      expect(records[recordOneHash]).not.toBeDefined();
      expect(records[recordTwoHash]).not.toBeNull();
      expect(records[recordTwoHash].data).toEqual(recordTwo);
    })
    .then(removeDataset(datasetOneId))
    .then(removeDataset(datasetTwoId))
    .catch(function(err) {
      expect(err).toBeNull();
    });
  });

  it('should update uid after remote update', function() {
    return manage(datasetId)
    .then(doCreate(datasetId, testData))
    .then(function(record) {
      return new Promise(function verifyUidIsHash(resolve) {
        const recordUid = $fh.sync.getUID(record.hash);
        expect(record.hash).toEqual(recordUid);
        resolve();
      })
      .then(waitForSyncEvent('remote_update_applied'))
      .then(function verifyUidIsUpdated(event) {
        const recordUid = $fh.sync.getUID(record.hash);
        expect(event.uid).toEqual(recordUid);
      });
    })
    .catch(function(err) {
      expect(err).toBeNull();
    });
  });
});

